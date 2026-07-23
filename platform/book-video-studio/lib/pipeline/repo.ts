import { db } from "../db";
import { tasks, steps, artifacts } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { STEP_NAMES, type StepName } from "./steps";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "./data";
export const PROJECT_ROOT = path.resolve(
  process.env.BOOK_VIDEO_PROJECT_ROOT || path.join(process.cwd(), "..", ".."),
);

function chinaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function initializeWorkDir(id: string) {
  const date = chinaDate();
  const dir = path.join(PROJECT_ROOT, "work", `${date}-待确认书名-${id.slice(0, 6)}`);
  for (const rel of [
    "video_clips",
    "storyboard/images",
    "storyboard/prompts",
    "material",
    "voice",
    "render",
    "jianying_draft",
    "cover",
  ]) {
    fs.mkdirSync(path.join(dir, rel), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, "production-config.json"), JSON.stringify({
    projectId: id,
    workflow: "douyin-book-intake-v1",
    status: "intake",
    currentGate: "INTAKE",
    createdAt: new Date().toISOString(),
  }, null, 2) + "\n", "utf8");
  return dir;
}

function safeBookFolderName(bookTitle: string) {
  const normalized = bookTitle
    .normalize("NFKC")
    .replace(/[《》]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 60);
  if (!normalized) throw new Error("书名无法转换为有效的文件夹名称");
  return normalized;
}

function availableBookWorkDir(currentDir: string, date: string, bookTitle: string) {
  const workRoot = path.resolve(PROJECT_ROOT, "work");
  const baseName = `${date}-${safeBookFolderName(bookTitle)}`;
  const baseDir = path.join(workRoot, baseName);
  if (path.resolve(currentDir) === path.resolve(baseDir) || !fs.existsSync(baseDir)) return baseDir;
  for (let index = 2; index < 100; index += 1) {
    const candidate = path.join(workRoot, `${baseName}-${String(index).padStart(2, "0")}`);
    if (path.resolve(currentDir) === path.resolve(candidate) || !fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`同名图书工作目录过多：${baseName}`);
}

export function renameTaskWorkDirForBook(taskId: string, bookTitle: string) {
  const task = getTask(taskId);
  if (!task?.projectPath) throw new Error("任务工作目录不存在");

  const workRoot = path.resolve(PROJECT_ROOT, "work");
  const currentDir = path.resolve(task.projectPath);
  if (currentDir === workRoot || !currentDir.startsWith(workRoot + path.sep)) {
    throw new Error(`任务工作目录不在 work/ 内：${currentDir}`);
  }
  if (!fs.existsSync(currentDir)) throw new Error(`任务工作目录不存在：${currentDir}`);

  const date = path.basename(currentDir).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || chinaDate();
  const targetDir = availableBookWorkDir(currentDir, date, bookTitle);
  if (path.resolve(targetDir) === currentDir) return currentDir;

  const oldRelative = path.relative(PROJECT_ROOT, currentDir).replaceAll(path.sep, "/");
  const newRelative = path.relative(PROJECT_ROOT, targetDir).replaceAll(path.sep, "/");
  fs.renameSync(currentDir, targetDir);

  for (const artifact of getArtifacts(taskId)) {
    const storedPath = artifact.path?.replaceAll("\\", "/");
    if (!storedPath || (storedPath !== oldRelative && !storedPath.startsWith(`${oldRelative}/`))) continue;
    db.update(artifacts)
      .set({ path: `${newRelative}${storedPath.slice(oldRelative.length)}` })
      .where(eq(artifacts.id, artifact.id))
      .run();
  }
  updateTask(taskId, { projectPath: targetDir });

  const configPath = path.join(targetDir, "production-config.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      fs.writeFileSync(configPath, JSON.stringify({
        ...config,
        bookTitle,
        projectFolder: path.basename(targetDir),
      }, null, 2) + "\n", "utf8");
    } catch {
      // 目录迁移已经完成；旧配置损坏时不覆盖，避免丢失审计信息。
    }
  }
  return targetDir;
}

export function taskDir(taskId: string) {
  const task = getTask(taskId);
  const dir = task?.projectPath
    ? path.resolve(task.projectPath)
    : path.resolve(DATA_DIR, "tasks", taskId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function projectArtifactPath(filePath: string) {
  const absolute = path.resolve(filePath);
  const workRoot = path.resolve(PROJECT_ROOT, "work");
  if (!absolute.startsWith(workRoot + path.sep)) {
    throw new Error(`产物路径不在 work/ 内: ${absolute}`);
  }
  return path.relative(PROJECT_ROOT, absolute).replaceAll(path.sep, "/");
}

export function resolveArtifactPath(storedPath: string) {
  const normalized = storedPath.replaceAll("\\", "/");
  if (normalized.startsWith("work/")) return path.resolve(PROJECT_ROOT, normalized);
  return path.resolve(process.cwd(), storedPath);
}

export function createTask(sourceUrl: string, keyword?: string) {
  const id = nanoid(12);
  const now = Date.now();
  const projectPath = initializeWorkDir(id);
  db.insert(tasks).values({
    id, sourceUrl, keyword: keyword ?? null,
    projectPath,
    currentGate: "INTAKE",
    status: "created", createdAt: now, updatedAt: now,
  }).run();
  // 初始化全部 step 为 pending
  for (const name of STEP_NAMES) {
    db.insert(steps).values({
      id: nanoid(12), taskId: id, name, status: "pending", progress: 0,
    }).run();
  }
  return id;
}

function extractUrlLike(input: string): string {
  return input.match(/https?:\/\/[^\s，。；,;]+/i)?.[0] || input;
}

function decodeLoose(value: string): string {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

export function sourceDuplicateKey(sourceUrl: string): string {
  const raw = extractUrlLike(sourceUrl).trim();
  const decoded = decodeLoose(raw);
  const stableIdPatterns = [
    { prefix: "douyin", pattern: /[?&](?:modal_id|aweme_id|item_id|group_id)=([0-9]{10,})/i },
    { prefix: "douyin", pattern: /\/(?:video|note|share\/video)\/([0-9]{10,})/i },
    { prefix: "wechat-channels", pattern: /weixin\.qq\.com\/sph\/([A-Za-z0-9_-]+)/i },
  ];
  for (const { prefix, pattern } of stableIdPatterns) {
    const match = decoded.match(pattern) || raw.match(pattern);
    if (match?.[1]) return `${prefix}:${match[1]}`;
  }

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (/douyin\.com$/.test(host) && pathname !== "/") return `url:${host}${pathname.toLowerCase()}`;
    const ignoredParams = new Set([
      "aid", "app", "enter_from", "from", "previous_page", "refer", "share_app_id",
      "share_iid", "share_link_id", "share_sign", "share_token", "share_time",
      "timestamp", "u_code",
    ]);
    const params = Array.from(url.searchParams.entries())
      .filter(([key]) => !ignoredParams.has(key.toLowerCase()) && !key.toLowerCase().startsWith("utm_"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    return `url:${host}${pathname.toLowerCase()}${params ? `?${params}` : ""}`;
  } catch {
    return `text:${raw.replace(/\s+/g, " ").toLowerCase()}`;
  }
}

export function findTaskBySourceDuplicate(sourceUrl: string, excludeId?: string) {
  const key = sourceDuplicateKey(sourceUrl);
  return listTasks().find((task) => task.id !== excludeId && sourceDuplicateKey(task.sourceUrl) === key);
}

export function getTask(id: string) {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

export function listTasks() {
  return db.select().from(tasks).all().sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteTask(id: string) {
  if (!getTask(id)) return false;
  throw new Error("第一版已禁用任务删除。请保留审计记录，需要清理时由用户手动处理。");
}

export function getSteps(taskId: string) {
  return db.select().from(steps).where(eq(steps.taskId, taskId)).all();
}

// 补齐缺失的 step 行（用于新增可选步骤后，老任务向后兼容）
export function ensureSteps(taskId: string) {
  const existing = new Set(getSteps(taskId).map((s) => s.name));
  for (const name of STEP_NAMES) {
    if (!existing.has(name)) {
      db.insert(steps).values({
        id: nanoid(12), taskId, name, status: "pending", progress: 0,
      }).run();
    }
  }
}

export function getStep(taskId: string, name: StepName) {
  return db.select().from(steps)
    .where(and(eq(steps.taskId, taskId), eq(steps.name, name))).get();
}

export function setStepStatus(
  taskId: string, name: StepName,
  patch: Partial<{ status: string; output: string; error: string; progress: number; startedAt: number; finishedAt: number }>
) {
  db.update(steps).set(patch)
    .where(and(eq(steps.taskId, taskId), eq(steps.name, name))).run();
}

export function updateTask(id: string, patch: Partial<typeof tasks.$inferInsert>) {
  db.update(tasks).set({ ...patch, updatedAt: Date.now() }).where(eq(tasks.id, id)).run();
}

export function updateTaskNotes(id: string, notes: string | null) {
  updateTask(id, { notes });
  return getTask(id);
}

export function stopRunningTask(id: string, reason = "用户手动停止任务") {
  const now = Date.now();
  const runningSteps = getSteps(id).filter((step) => step.status === "running");
  for (const step of runningSteps) {
    setStepStatus(id, step.name as StepName, {
      status: "failed",
      error: reason,
      finishedAt: now,
    });
  }
  updateTask(id, { status: "failed" });
  return runningSteps.length;
}

export function saveArtifact(a: {
  taskId: string; stepName: string; kind: string;
  label?: string; path?: string; content?: string; meta?: any;
}) {
  const id = nanoid(12);
  db.insert(artifacts).values({
    id, taskId: a.taskId, stepName: a.stepName, kind: a.kind,
    label: a.label ?? null, path: a.path ?? null, content: a.content ?? null,
    meta: a.meta ? JSON.stringify(a.meta) : null, createdAt: Date.now(),
  }).run();
  return id;
}

export function getArtifacts(taskId: string) {
  return db.select().from(artifacts).where(eq(artifacts.taskId, taskId)).all();
}

// 重跑某步前清掉它上次产生的产物，避免重复堆积
export function clearArtifacts(taskId: string, stepName: string) {
  db.delete(artifacts)
    .where(and(eq(artifacts.taskId, taskId), eq(artifacts.stepName, stepName))).run();
}

export function clearArtifactsByKind(taskId: string, stepName: string, kind: string) {
  db.delete(artifacts)
    .where(and(eq(artifacts.taskId, taskId), eq(artifacts.stepName, stepName), eq(artifacts.kind, kind))).run();
}

export function getArtifactById(id: string) {
  return db.select().from(artifacts).where(eq(artifacts.id, id)).get();
}

// 人工编辑文本类产物（如改写稿）：更新 content，并落盘对应文件（若有 path）
export function updateArtifactContent(id: string, content: string) {
  const a = getArtifactById(id);
  if (!a) throw new Error("产物不存在");
  db.update(artifacts).set({ content }).where(eq(artifacts.id, id)).run();
  if (a.path) {
    try { fs.writeFileSync(path.resolve(a.path), content, "utf-8"); } catch { /* 文件可选 */ }
  }
  return a;
}

export function patchArtifact(
  id: string,
  patch: Partial<Pick<typeof artifacts.$inferInsert, "label" | "path" | "content" | "meta">>
) {
  db.update(artifacts).set(patch).where(eq(artifacts.id, id)).run();
  return getArtifactById(id);
}
