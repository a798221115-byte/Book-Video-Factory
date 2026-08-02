import fs from "node:fs";
import path from "node:path";
import {
  getArtifactById,
  getArtifacts,
  getTask,
  patchArtifact,
  projectArtifactPath,
  saveArtifact,
  taskDir,
  updateTask,
} from "./pipeline/repo";
import { registerRemainingImageFile } from "./remainingImageRegistry";
import { parseArtifactMeta, startRemainingImageQueue } from "./storyboardGeneration";
import { getImage } from "./providers/image";

type RemainingJobStatus = "queued" | "starting" | "running" | "succeeded" | "failed";

export type CodexRemainingImagesJobMeta = {
  jobType: "remaining_images";
  status: RemainingJobStatus;
  phase: string;
  message: string;
  progress: number;
  completed: number;
  total: number;
  threadId: string | null;
  eventLogPath: string | null;
  createdAt: number;
  startedAt: number | null;
  heartbeatAt: number | null;
  finishedAt: number | null;
  error: string | null;
};

function parseMeta(raw: string | null | undefined): CodexRemainingImagesJobMeta | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value?.jobType === "remaining_images" ? value : null;
  } catch {
    return null;
  }
}

function isInvalidated(raw: string | null | undefined) {
  try { return Boolean(raw && JSON.parse(raw).invalidatedAt); }
  catch { return false; }
}

export function getLatestCodexRemainingImagesJob(taskId: string) {
  return getArtifacts(taskId)
    .filter((item) => item.stepName === "storyboard" && item.kind === "codex_job" && !isInvalidated(item.meta))
    .map((artifact) => ({ artifact, meta: parseMeta(artifact.meta) }))
    .filter((item): item is { artifact: typeof item.artifact; meta: CodexRemainingImagesJobMeta } => Boolean(item.meta))
    .sort((a, b) => b.artifact.createdAt - a.artifact.createdAt)[0] || null;
}

const runningJobs = new Map<string, Promise<void>>();

function updateJob(jobArtifactId: string, patch: Partial<CodexRemainingImagesJobMeta>) {
  const artifact = getArtifactById(jobArtifactId);
  const current = parseMeta(artifact?.meta);
  if (!artifact || !current) throw new Error("GPT Image 2 G04 任务记录不存在");
  const next = { ...current, ...patch };
  patchArtifact(jobArtifactId, { meta: JSON.stringify(next) });
  return next;
}

function manifestFor(taskId: string) {
  const artifact = getArtifacts(taskId).find(
    (item) => item.stepName === "storyboard" && item.kind === "remaining_image_manifest",
  );
  if (!artifact) throw new Error("剩余分镜生图队列不存在");
  return { artifact, manifest: parseArtifactMeta(artifact.meta) };
}

function syncCompletedFiles(taskId: string, codexJobId: string) {
  const { manifest } = manifestFor(taskId);
  for (const scene of manifest.jobs || []) {
    if (scene.status === "done") continue;
    const imagePath = path.join(taskDir(taskId), "storyboard", "images", path.basename(scene.imageFileName));
    if (!fs.existsSync(imagePath) || fs.statSync(imagePath).size < 10_000) continue;
    registerRemainingImageFile(taskId, {
      sceneJobId: scene.id,
      imageFileName: scene.imageFileName,
      codexJobId,
    });
  }
  const refreshed = manifestFor(taskId).manifest;
  const total = (refreshed.jobs || []).length;
  const completed = (refreshed.jobs || []).filter((item: any) => item.status === "done").length;
  return { total, completed, allDone: total > 0 && completed === total };
}

function buildPrompt(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  const { manifest } = manifestFor(taskId);
  const sample = getArtifacts(taskId).find(
    (item) => item.stepName === "storyboard" && item.kind === "style_sample" && !isInvalidated(item.meta),
  );
  if (!sample?.path) throw new Error("缺少已确认的 G03 风格样图");
  const samplePath = path.resolve(path.join(taskDir(taskId), "..", ".."), sample.path);
  const pending = (manifest.jobs || []).filter((item: any) => item.status !== "done");
  const lines = pending.map((scene: any, index: number) => [
    `${index + 1}. 分镜 ${scene.id}｜${scene.label}`,
    `   提示词：${path.join(taskDir(taskId), "storyboard", "prompts", path.basename(scene.promptFileName))}`,
    `   输出图片：${path.join(taskDir(taskId), "storyboard", "images", path.basename(scene.imageFileName))}`,
  ].join("\n"));
  return [
    `【Book Video Studio｜G04 剩余分镜｜${task.bookTitle || taskId}】`,
    `你正在执行工作台自动派发的 G04 剩余分镜生图任务。任务 ID：${taskId}。`,
    `已确认 G03 样图：${samplePath}`,
    "",
    "严格要求：",
    "1. 完整阅读当前项目 AGENTS.md、storyboard/storyboard.json、各分镜提示词和已确认样图。",
    "2. 不得调用内置生图能力；工作台会通过指定 GPT Image 2 API kit 按清单逐张生成。",
    "3. 所有图片严格沿用已确认样图的画风、色彩、人物身份、时代背景、光线和构图规则，但不得复制相同构图。",
    "4. 图片为 9:16 竖屏，无文字、无书名、无字幕、无标志、无水印。",
    "5. 不修改已确认文案，不进入配音、字幕、视频、封面、发布或归档。",
    "6. 必须完成清单中所有待生成图片；不要额外生成清单外图片。",
    "",
    ...lines,
  ].join("\n");
}

function appendEvent(logPath: string, event: unknown) {
  const json = JSON.stringify({ at: Date.now(), event }, (_key, value) =>
    typeof value === "string" && value.length > 4_000
      ? `${value.slice(0, 4_000)}…[truncated ${value.length - 4_000} chars]`
      : value,
  );
  fs.appendFileSync(logPath, `${json}\n`, "utf8");
}

async function runJob(taskId: string, jobArtifactId: string) {
  const initial = parseMeta(getArtifactById(jobArtifactId)?.meta);
  if (!initial) throw new Error("GPT Image 2 G04 任务记录不存在");
  const logDir = path.join(taskDir(taskId), "storyboard", "codex-jobs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${jobArtifactId}.jsonl`);
  updateJob(jobArtifactId, {
    status: "starting",
    phase: "starting",
    message: "正在启动 GPT Image 2 G04 任务",
    progress: Math.max(0.03, initial.total ? initial.completed / initial.total : 0.03),
    startedAt: initial.startedAt || Date.now(),
    heartbeatAt: Date.now(),
    eventLogPath: projectArtifactPath(logPath),
    error: null,
  });

  const { manifest } = manifestFor(taskId);
  const sample = getArtifacts(taskId).find(
    (item) => item.stepName === "storyboard" && item.kind === "style_sample" && !isInvalidated(item.meta),
  );
  if (!sample?.path) throw new Error("缺少已确认的 G03 风格样图");
  const samplePath = path.resolve(path.join(taskDir(taskId), "..", ".."), sample.path);
  const pending = (manifest.jobs || []).filter((item: any) => item.status !== "done");
  const provider = getImage();
  for (let index = 0; index < pending.length; index++) {
    const scene = pending[index];
    const promptPath = path.join(taskDir(taskId), "storyboard", "prompts", path.basename(scene.promptFileName));
    const imagePath = path.join(taskDir(taskId), "storyboard", "images", path.basename(scene.imageFileName));
    if (!fs.existsSync(promptPath)) throw new Error(`分镜提示词不存在：${promptPath}`);
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    const prompt = [
      fs.readFileSync(promptPath, "utf8").trim(),
      "Use the supplied G03 image only as a style and character-continuity reference. Create the new scene and composition described above; do not copy the reference composition.",
    ].join("\n\n");
    if (!provider.edit) throw new Error("当前 GPT Image 2 provider 不支持图片编辑接口");
    await provider.edit(prompt, samplePath, imagePath, {
      size: "1024x1792",
      onProgress: (event) => updateJob(jobArtifactId, {
        status: "running",
        phase: event.stage === "retry" ? "retrying" : "generating",
        message: event.stage === "retry"
          ? `GPT Image 2 正在重试分镜 ${scene.id}（${event.attempt}/${event.maxAttempts}）`
          : `GPT Image 2 API kit 正在生成分镜 ${scene.id}（${index + 1}/${pending.length}）`,
        progress: initial.total ? Math.min(0.96, (initial.completed + index + 0.5) / initial.total) : 0.1,
        heartbeatAt: Date.now(),
      }),
    });
    registerRemainingImageFile(taskId, {
      sceneJobId: scene.id,
      imageFileName: scene.imageFileName,
      codexJobId: jobArtifactId,
    });
    appendEvent(logPath, { provider: provider.name, sceneJobId: scene.id, imagePath: projectArtifactPath(imagePath) });
  }
  const counts = syncCompletedFiles(taskId, jobArtifactId);
  if (!counts.allDone) {
    throw new Error(`GPT Image 2 任务结束，但仍有 ${counts.total - counts.completed} 张分镜未生成`);
  }
  updateJob(jobArtifactId, {
    status: "succeeded",
    phase: "completed",
    message: `全部 ${counts.total} 张分镜已生成并写回，等待你的 G04 审核`,
    progress: 1,
    completed: counts.completed,
    total: counts.total,
    heartbeatAt: Date.now(),
    finishedAt: Date.now(),
    error: null,
  });
}

function launch(taskId: string, jobArtifactId: string) {
  if (runningJobs.has(jobArtifactId)) return;
  const promise = runJob(taskId, jobArtifactId)
    .catch((error: any) => {
      const counts = (() => {
        try { return syncCompletedFiles(taskId, jobArtifactId); }
        catch { return { completed: 0, total: 0 }; }
      })();
      updateJob(jobArtifactId, {
        status: "failed",
        phase: "failed",
        message: "GPT Image 2 G04 任务失败，可保留已完成图片后重试",
        progress: counts.total ? counts.completed / counts.total : 0,
        completed: counts.completed,
        total: counts.total,
        heartbeatAt: Date.now(),
        finishedAt: Date.now(),
        error: String(error?.message || error),
      });
    })
    .finally(() => runningJobs.delete(jobArtifactId));
  runningJobs.set(jobArtifactId, promise);
}

export function enqueueCodexRemainingImages(
  taskId: string,
  options: { force?: boolean; imageRevision?: number } = {},
) {
  const manifest = startRemainingImageQueue(taskId, {
    imageRevision: options.imageRevision,
  });
  const latest = getLatestCodexRemainingImagesJob(taskId);
  if (!options.force && latest && ["queued", "starting", "running", "succeeded"].includes(latest.meta.status)) {
    if (["queued", "starting", "running"].includes(latest.meta.status)) launch(taskId, latest.artifact.id);
    return { job: latest, manifest };
  }
  const completed = (manifest.jobs || []).filter((item: any) => item.status === "done").length;
  const total = (manifest.jobs || []).length;
  const now = Date.now();
  const meta: CodexRemainingImagesJobMeta = {
    jobType: "remaining_images",
    status: "queued",
    phase: "queued",
    message: `G04 已进入 Codex 队列（${completed}/${total}）`,
    progress: total ? completed / total : 0,
    completed,
    total,
    threadId: null,
    eventLogPath: null,
    createdAt: now,
    startedAt: null,
    heartbeatAt: now,
    finishedAt: null,
    error: null,
  };
  const jobArtifactId = saveArtifact({
    taskId,
    stepName: "storyboard",
    kind: "codex_job",
    label: "G04 Codex 自动生图任务",
    meta,
  });
  launch(taskId, jobArtifactId);
  return { job: { artifact: getArtifactById(jobArtifactId)!, meta }, manifest };
}
