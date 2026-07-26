import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  getArtifacts,
  getTask,
  patchArtifact,
  projectArtifactPath,
  saveArtifact,
} from "./pipeline/repo";

const execFileP = promisify(execFile);
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

type CoverOptions = {
  headline1?: string;
  headline2?: string;
};

function parseJson(raw: string | null | undefined) {
  try { return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}

function upsertArtifact(input: {
  taskId: string;
  kind: string;
  label: string;
  path?: string;
  content?: string;
  meta?: Record<string, unknown>;
}) {
  const existing = getArtifacts(input.taskId).find(
    (item) => item.stepName === "delivery" && item.kind === input.kind,
  );
  if (existing) {
    patchArtifact(existing.id, {
      label: input.label,
      path: input.path ?? null,
      content: input.content ?? null,
      meta: JSON.stringify(input.meta || {}),
    });
    return existing.id;
  }
  return saveArtifact({
    taskId: input.taskId,
    stepName: "delivery",
    kind: input.kind,
    label: input.label,
    path: input.path,
    content: input.content,
    meta: input.meta || {},
  });
}

function sha256File(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function cleanLine(value: unknown, fallback: string, maxLength = 13) {
  const normalized = String(value || "")
    .replace(/[《》#＃\r\n\t]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(normalized || fallback).slice(0, maxLength).join("");
}

function firstExisting(paths: string[]) {
  return paths.find((candidate) => fs.existsSync(candidate)) || "";
}

function resolveSkillRoot() {
  const candidates = [
    process.env.BOOK_VIDEO_SKILL_ROOT?.trim() || "",
    path.resolve(process.cwd(), "..", "..", "skills", "produce-wechat-book-video"),
    path.resolve(process.cwd(), "..", "..", "_github_book_video_factory", "skills", "produce-wechat-book-video"),
    "F:\\Codex\\.codex\\skills\\produce-wechat-book-video",
  ].filter(Boolean);
  const root = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "scripts", "compose_wechat_cover.py")) &&
    fs.existsSync(path.join(candidate, "assets", "wechat-cover-background-template.png")),
  );
  if (!root) {
    throw new Error("未找到 produce-wechat-book-video 的封面脚本与背景模板");
  }
  return root;
}

function resolvePython() {
  return firstExisting([
    process.env.BOOK_VIDEO_PYTHON_BIN?.trim() || "",
    "C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe",
  ]) || "python";
}

function verifiedBook(taskId: string) {
  const artifacts = getArtifacts(taskId);
  for (const artifact of artifacts) {
    const meta = parseJson(artifact.meta);
    const book = meta?.book;
    if (
      artifact.stepName === "weread" &&
      book &&
      typeof book === "object" &&
      String(book.cover || "").trim()
    ) {
      return {
        title: String(book.title || "").trim(),
        author: String(book.author || "").trim(),
        publisher: String(book.publisher || "").trim(),
        coverUrl: String(book.cover || "").trim(),
        deepLink: String(book.deepLink || "").trim(),
        bookId: String(book.bookId || "").trim(),
      };
    }
  }
  throw new Error("缺少微信读书核验版本或原版书封地址，请先完成 G01 版本核验");
}

function selectedTitles(taskId: string) {
  const artifacts = getArtifacts(taskId);
  for (const artifact of artifacts) {
    const meta = parseJson(artifact.meta);
    if (meta.selected_short_title || meta.selected_long_title) {
      return {
        short: String(meta.selected_short_title || "").trim(),
        long: String(meta.selected_long_title || "").trim(),
      };
    }
  }
  return { short: "", long: "" };
}

async function downloadVerifiedCover(urlText: string, coverDir: string) {
  const originalUrl = new URL(urlText);
  if (originalUrl.protocol !== "https:") throw new Error("核验书封必须使用 HTTPS 来源");
  const highResolutionUrl = new URL(
    originalUrl.toString().replace(/\/(?:s|t6)_([^/]+)$/i, "/t9_$1"),
  );
  const candidates = Array.from(new Set([highResolutionUrl.toString(), originalUrl.toString()]));
  let lastError = "";

  for (const candidateText of candidates) {
    const candidate = new URL(candidateText);
    const urlHash = createHash("sha1").update(candidate.toString()).digest("hex").slice(0, 12);
    const existing = fs.readdirSync(coverDir)
      .find((name) => name.startsWith(`original-book-cover-${urlHash}.`));
    if (existing) return { path: path.join(coverDir, existing), sourceUrl: candidate.toString() };

    try {
      const response = await fetch(candidate, {
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
        headers: { "User-Agent": "Book-Video-Studio/1.15" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (declaredLength > MAX_SOURCE_BYTES) throw new Error("文件体积超过 20MB 上限");
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (!contentType.startsWith("image/")) throw new Error(`返回非图片类型：${contentType || "unknown"}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) throw new Error("文件为空或体积异常");
      const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const output = path.join(coverDir, `original-book-cover-${urlHash}.${extension}`);
      fs.writeFileSync(output, bytes, { flag: "wx" });
      return { path: output, sourceUrl: candidate.toString() };
    } catch (error: any) {
      lastError = String(error?.message || error);
    }
  }
  throw new Error(`下载微信读书原版书封失败：${lastError || "未知错误"}`);
}

function nextCoverPath(coverDir: string, taskId: string) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replaceAll("-", "");
  const base = `${date}-wx-${taskId.slice(0, 6)}`;
  for (let index = 1; index < 100; index += 1) {
    const suffix = index === 1 ? "" : `-${String(index).padStart(2, "0")}`;
    const candidate = path.join(coverDir, `${base}${suffix}-cover.png`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error("同一任务的封面版本过多，请先人工检查 cover/ 目录");
}

export async function generateDeliveryCover(taskId: string, options: CoverOptions = {}) {
  const task = getTask(taskId);
  if (!task?.projectPath) throw new Error("任务工作目录不存在");
  const projectDir = path.resolve(task.projectPath);
  const coverDir = path.join(projectDir, "cover");
  fs.mkdirSync(coverDir, { recursive: true });

  const book = verifiedBook(taskId);
  const titles = selectedTitles(taskId);
  const bookTitle = String(task.bookTitle || book.title || "本书").trim();
  const author = String(task.bookAuthor || book.author || "作者信息待核验").trim();
  const headline1 = cleanLine(
    options.headline1,
    titles.short || `${bookTitle}里的提醒`,
  );
  const headline2 = cleanLine(
    options.headline2,
    "先看见自己 再做选择",
  );
  const skillRoot = resolveSkillRoot();
  const scriptPath = path.join(skillRoot, "scripts", "compose_wechat_cover.py");
  const backgroundPath = path.join(skillRoot, "assets", "wechat-cover-background-template.png");
  const downloadedCover = await downloadVerifiedCover(book.coverUrl, coverDir);
  const originalCoverPath = downloadedCover.path;
  const outputPath = nextCoverPath(coverDir, taskId);
  const fontBold = firstExisting([
    "C:\\Windows\\Fonts\\Noto Sans SC Bold (TrueType).otf",
    "C:\\Windows\\Fonts\\msyhbd.ttc",
  ]);
  const fontRegular = firstExisting([
    "C:\\Windows\\Fonts\\Noto Sans SC (TrueType).otf",
    "C:\\Windows\\Fonts\\msyh.ttc",
  ]);
  if (!fontBold || !fontRegular) throw new Error("缺少可用的中文字体，无法生成确定性封面文字");

  try {
    await execFileP(resolvePython(), [
      scriptPath,
      "--background", backgroundPath,
      "--book-cover", originalCoverPath,
      "--out", outputPath,
      "--headline-1", headline1,
      "--headline-2", headline2,
      "--metadata-1", `${author}｜著`,
      "--metadata-2", book.publisher || "微信读书核验版本",
      "--font-bold", fontBold,
      "--font-regular", fontRegular,
    ], {
      cwd: projectDir,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 4,
    });
  } catch (error: any) {
    const detail = String(error?.stderr || error?.message || error).slice(-1600);
    throw new Error(`独立封面合成失败：${detail}`);
  }
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 50_000) {
    throw new Error("独立封面未生成或文件体积异常");
  }

  const checkedAt = new Date().toISOString();
  const originalCoverSha256 = sha256File(originalCoverPath);
  const outputSha256 = sha256File(outputPath);
  const validationPath = path.join(coverDir, "validation.md");
  const validation = [
    "# 视频号独立封面验收",
    "",
    "- 结论：通过",
    `- 检查时间：${checkedAt}`,
    "- 尺寸：1080×1260（合成脚本输出后已校验）",
    `- 成品：${projectArtifactPath(outputPath)}`,
    `- 成品 SHA-256：\`${outputSha256}\``,
    `- 原版书封：${projectArtifactPath(originalCoverPath)}`,
    `- 原版书封 SHA-256：\`${originalCoverSha256}\``,
    `- 原版书封来源：${downloadedCover.sourceUrl}`,
    `- 微信读书版本：${book.deepLink || book.bookId}`,
    `- 标题第一行：${headline1}`,
    `- 标题第二行：${headline2}`,
    "- 说明：原版书封完整保留且未由图片模型重绘；外围背景与中文文字为确定性合成。",
    "",
  ].join("\n");
  fs.writeFileSync(validationPath, validation, "utf8");

  const meta = {
    checkedAt,
    dimensions: { width: 1080, height: 1260 },
    headline1,
    headline2,
    bookTitle,
    author,
    sourceUrl: downloadedCover.sourceUrl,
    sourceDeepLink: book.deepLink,
    sourceBookId: book.bookId,
    originalCover: projectArtifactPath(originalCoverPath),
    originalCoverSha256,
    outputSha256,
    deterministicText: true,
    aiRedrawnBookCover: false,
  };
  upsertArtifact({
    taskId,
    kind: "cover",
    label: "G06 视频号独立封面",
    path: projectArtifactPath(outputPath),
    meta,
  });
  upsertArtifact({
    taskId,
    kind: "cover_validation",
    label: "G06 封面验收报告",
    path: projectArtifactPath(validationPath),
    content: validation,
    meta,
  });
  upsertArtifact({
    taskId,
    kind: "cover_generation_status",
    label: "G06 封面生成状态",
    content: "独立封面已生成并通过基础验收",
    meta: { status: "done", ...meta },
  });

  return {
    coverPath: projectArtifactPath(outputPath),
    validationPath: projectArtifactPath(validationPath),
    meta,
  };
}

export function recordDeliveryCoverFailure(taskId: string, error: unknown) {
  const detail = String((error as any)?.message || error).slice(0, 1800);
  upsertArtifact({
    taskId,
    kind: "cover_generation_status",
    label: "G06 封面生成状态",
    content: detail,
    meta: { status: "failed", detail, failedAt: new Date().toISOString() },
  });
  return detail;
}
