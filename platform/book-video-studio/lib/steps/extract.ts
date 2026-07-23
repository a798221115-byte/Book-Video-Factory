import { getVideoProvider, redactSourceVideoForArtifact, type SourceVideo } from "../providers/video";
import { getTask, updateTask, saveArtifact, setStepStatus, clearArtifacts, taskDir, projectArtifactPath } from "../pipeline/repo";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execP = promisify(exec);

async function downloadToFile(url: string, output: string, headers: Record<string, string> = {}) {
  const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (iPhone)", ...headers } });
  if (!resp.ok) throw new Error(`视频下载失败 ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(output, buf);
}

function looksLikeMp4(file: string) {
  if (!fs.existsSync(file)) return false;
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(12);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return n >= 8 && buf.subarray(4, 8).toString("ascii") === "ftyp";
  } finally {
    fs.closeSync(fd);
  }
}

function shellQuote(value: string) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function decryptWechatViaApi(input: string, output: string, decodeKey: string) {
  const base = process.env.WECHAT_DECRYPT_API_URL?.trim().replace(/\/$/, "");
  if (!base) throw new Error("WECHAT_DECRYPT_API_URL 未配置");
  const form = new FormData();
  form.append("decode_key", decodeKey);
  form.append("video", new Blob([fs.readFileSync(input)], { type: "video/mp4" }), path.basename(input));
  const resp = await fetch(`${base}/api/decrypt`, { method: "POST", body: form });
  if (!resp.ok) throw new Error(`视频号解密 API 失败 ${resp.status}: ${await resp.text()}`);
  fs.writeFileSync(output, Buffer.from(await resp.arrayBuffer()));
}

async function decryptWechatViaCommand(input: string, output: string, decodeKey: string) {
  const tpl = process.env.WECHAT_DECRYPT_COMMAND?.trim();
  if (!tpl) throw new Error("WECHAT_DECRYPT_COMMAND 未配置");
  const command = tpl
    .replaceAll("{input}", shellQuote(input))
    .replaceAll("{output}", shellQuote(output))
    .replaceAll("{decodeKey}", shellQuote(decodeKey));
  await execP(command, { maxBuffer: 1024 * 1024 * 64 });
}

async function downloadSourceVideo(taskId: string, video: SourceVideo, dir: string): Promise<string | undefined> {
  if (video.platform === "mock" || video.downloadUrl === "MOCK") return undefined;

  const date = path.basename(dir).slice(0, 10);
  const videoPath = path.join(dir, `reference-${date}.mp4`);
  if (video.platform === "wechat_channels") {
    if (!video.encryptedDownloadUrl) throw new Error("视频号详情缺少媒体下载地址");
    const encryptedPath = path.join(dir, "source.encrypted.mp4");
    await downloadToFile(video.encryptedDownloadUrl, encryptedPath, { Referer: "https://weixin.qq.com/" });
    saveArtifact({
      taskId, stepName: "extract", kind: "json", label: "视频号加密源视频",
      path: path.relative(process.cwd(), encryptedPath),
      meta: { platform: video.platform, decodeKey: video.decodeKey ? "已获取" : "缺失" },
    });
    if (looksLikeMp4(encryptedPath)) {
      fs.copyFileSync(encryptedPath, videoPath);
      return videoPath;
    }
    if (!video.decodeKey) throw new Error("视频号视频已下载但缺少 decode_key，无法解密");
    if (process.env.WECHAT_DECRYPT_API_URL?.trim()) {
      await decryptWechatViaApi(encryptedPath, videoPath, video.decodeKey);
    } else if (process.env.WECHAT_DECRYPT_COMMAND?.trim()) {
      await decryptWechatViaCommand(encryptedPath, videoPath, video.decodeKey);
    } else {
      throw new Error("视频号视频已下载但仍为加密文件。请配置 WECHAT_DECRYPT_API_URL 或 WECHAT_DECRYPT_COMMAND 后重试采集。");
    }
    if (!looksLikeMp4(videoPath)) throw new Error("视频号视频解密后不是有效 MP4，请检查 decode_key 和解密服务");
    return videoPath;
  }

  if (video.downloadUrl) {
    await downloadToFile(video.downloadUrl, videoPath);
    return videoPath;
  }
  return undefined;
}

function safeText(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString();
    if (typeof item === "function" || typeof item === "symbol" || item === undefined) return null;
    return item;
  });
}

export async function runExtract(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  clearArtifacts(taskId, "extract");

  setStepStatus(taskId, "extract", { progress: 0.1 });
  const provider = getVideoProvider(task.sourceUrl);
  const video = await provider.fetchVideo(task.sourceUrl);
  setStepStatus(taskId, "extract", { progress: 0.5 });

  // 回写任务 meta（取代手工 Excel）
  updateTask(taskId, {
    title: safeText(video.title),
    author: safeText(video.author),
    stats: safeJson(video.stats),
  });

  const dir = taskDir(taskId);

  // 下载原视频（视频号会先下载加密文件，再按配置解密成 source.mp4）
  const videoPath = await downloadSourceVideo(taskId, video, dir);
  setStepStatus(taskId, "extract", { progress: 0.8 });

  // 保存产物
  saveArtifact({
    taskId, stepName: "extract", kind: "json", label: "视频信息",
    meta: redactSourceVideoForArtifact(video),
  });
  const clipsDir = path.join(dir, "video_clips");
  fs.mkdirSync(clipsDir, { recursive: true });
  const metadataPath = path.join(clipsDir, "source-metadata.json");
  fs.writeFileSync(metadataPath, JSON.stringify(redactSourceVideoForArtifact(video), null, 2) + "\n", "utf8");
  saveArtifact({
    taskId, stepName: "extract", kind: "file", label: "来源元数据",
    path: projectArtifactPath(metadataPath),
  });
  if (videoPath) {
    saveArtifact({
      taskId, stepName: "extract", kind: "video", label: "原视频",
      path: projectArtifactPath(videoPath),
    });
  }
  // 原始 ASR（若接口直接给了字幕）
  if (video.rawAsr) {
    saveArtifact({
      taskId, stepName: "extract", kind: "transcript", label: "原始逐字稿(接口)",
      content: video.rawAsr,
    });
  }

  setStepStatus(taskId, "extract", {
    output: JSON.stringify({ title: video.title, author: video.author, stats: video.stats, hasVideo: !!videoPath, hasAsr: !!video.rawAsr }),
  });
}
