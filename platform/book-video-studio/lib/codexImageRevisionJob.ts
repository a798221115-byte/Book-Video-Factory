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
import { parseArtifactMeta } from "./storyboardGeneration";
import { runVisibleCodexTask, type CodexTaskEvent } from "./codexAppServer";

type ImageRevisionStatus = "queued" | "starting" | "running" | "succeeded" | "failed";

export type CodexImageRevisionJobMeta = {
  jobType: "image_revision";
  status: ImageRevisionStatus;
  phase: string;
  message: string;
  progress: number;
  sceneJobId: string;
  sceneLabel: string;
  revision: number;
  feedback: string;
  currentImagePath: string;
  expectedImageFileName: string;
  expectedPromptFileName: string;
  threadId: string | null;
  eventLogPath: string | null;
  returnStatus: "waiting_images_confirmation";
  createdAt: number;
  startedAt: number | null;
  heartbeatAt: number | null;
  finishedAt: number | null;
  error: string | null;
};

function parseMeta(raw: string | null | undefined): CodexImageRevisionJobMeta | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value?.jobType === "image_revision" ? value : null;
  } catch {
    return null;
  }
}

export function getLatestCodexImageRevisionJobs(taskId: string) {
  return getArtifacts(taskId)
    .filter((item) => item.stepName === "storyboard" && item.kind === "codex_job")
    .map((artifact) => ({ artifact, meta: parseMeta(artifact.meta) }))
    .filter((item): item is { artifact: typeof item.artifact; meta: CodexImageRevisionJobMeta } => Boolean(item.meta))
    .sort((a, b) => b.artifact.createdAt - a.artifact.createdAt);
}

const runningJobs = new Map<string, Promise<void>>();

function updateJob(jobArtifactId: string, patch: Partial<CodexImageRevisionJobMeta>) {
  const artifact = getArtifactById(jobArtifactId);
  const current = parseMeta(artifact?.meta);
  if (!artifact || !current) throw new Error("Codex 单张图片修改任务记录不存在");
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

function nextVersionedName(fileName: string, revision: number) {
  const base = path.basename(fileName || "storyboard-image-v1.png");
  if (/-v\d+\.[^.]+$/i.test(base)) return base.replace(/-v\d+(\.[^.]+)$/i, `-v${revision}$1`);
  const ext = path.extname(base) || ".png";
  return `${base.slice(0, -ext.length)}-v${revision}${ext}`;
}

function buildPrompt(taskId: string, scene: any, currentImagePath: string, outputImagePath: string, outputPromptPath: string, feedback: string, revision: number) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  const sample = getArtifacts(taskId).find(
    (item) => item.stepName === "storyboard" && item.kind === "style_sample",
  );
  const samplePath = sample?.path
    ? path.resolve(path.join(taskDir(taskId), "..", ".."), sample.path)
    : "";
  return [
    `【Book Video Studio｜单张分镜修改｜${task.bookTitle || taskId}｜${scene.id}】`,
    `你正在执行第 ${revision} 版单张分镜图片修改任务。任务 ID：${taskId}，分镜：${scene.id}｜${scene.label}。`,
    `当前图片：${currentImagePath}`,
    `已确认 G03 样图（仅用于保持统一风格）：${samplePath}`,
    "",
    "用户修改意见：",
    feedback,
    "",
    "严格要求：",
    "1. 先阅读当前项目 AGENTS.md、storyboard/storyboard.json、当前分镜提示词和当前图片。",
    "2. 使用内置 image_gen/imagegen，基于当前图片进行单张修改；只修改用户指出的内容，保留文案语义和整体画风。",
    "3. 输出仍为 9:16 竖屏；无中文、无英文、无书名、无字幕、无标志、无水印。",
    "4. 不修改其他分镜，不进入配音、字幕、视频、剪映草稿、封面、发布或归档。",
    `5. 将修改后的图片保存到：${outputImagePath}`,
    `6. 将本次实际提示词保存到：${outputPromptPath}`,
    "7. 完成后检查图片存在且可读取，并在最终回复中明确写出保存路径。",
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

function eventSummary(event: CodexTaskEvent) {
  if (event.type === "thread.started") return { phase: "thread_created", message: "Codex 单张修改任务已创建", progress: 0.12 };
  if (event.type === "turn.started") return { phase: "planning", message: "Codex 正在读取当前图片与修改意见", progress: 0.2 };
  if (event.type === "item.started") return { phase: "generating_image", message: "Codex 正在重新生成这张分镜", progress: 0.55 };
  if (event.type === "item.completed") return { phase: "saving", message: "修改后的图片正在写回工作台", progress: 0.78 };
  if (event.type === "turn.completed") return { phase: "registering", message: "Codex 已完成，正在登记图片版本", progress: 0.94 };
  return null;
}

async function runJob(taskId: string, jobArtifactId: string) {
  const initial = parseMeta(getArtifactById(jobArtifactId)?.meta);
  if (!initial) throw new Error("Codex 单张图片修改任务记录不存在");
  const logDir = path.join(taskDir(taskId), "storyboard", "codex-jobs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${jobArtifactId}.jsonl`);
  updateJob(jobArtifactId, {
    status: "starting",
    phase: "starting",
    message: "正在启动 Codex 单张图片修改任务",
    progress: 0.08,
    startedAt: initial.startedAt || Date.now(),
    heartbeatAt: Date.now(),
    eventLogPath: projectArtifactPath(logPath),
    error: null,
  });
  const projectRoot = path.resolve(path.join(taskDir(taskId), "..", ".."));
  const { manifest } = manifestFor(taskId);
  const scene = (manifest.jobs || []).find((item: any) => item.id === initial.sceneJobId);
  if (!scene) throw new Error("分镜任务不存在");
  const outputImagePath = path.join(taskDir(taskId), "storyboard", "images", initial.expectedImageFileName);
  const outputPromptPath = path.join(taskDir(taskId), "storyboard", "prompts", initial.expectedPromptFileName);
  const task = getTask(taskId);
  await runVisibleCodexTask({
    title: task?.bookTitle || task?.title || taskId,
    prompt: buildPrompt(taskId, scene, initial.currentImagePath, outputImagePath, outputPromptPath, initial.feedback, initial.revision),
    projectRoot,
    existingThreadId: task?.codexThreadId || initial.threadId,
    onEvent: async (event) => {
      if (event.type === "thread.started") updateTask(taskId, { codexThreadId: event.thread_id });
      appendEvent(logPath, event.raw);
      updateJob(jobArtifactId, {
        status: "running",
        threadId: event.type === "thread.started" ? event.thread_id : undefined,
        heartbeatAt: Date.now(),
        ...(eventSummary(event) || {}),
      });
    },
  });
  if (!fs.existsSync(outputImagePath) || fs.statSync(outputImagePath).size < 10_000) {
    throw new Error(`Codex 任务结束，但没有找到有效图片：${outputImagePath}`);
  }
  registerRemainingImageFile(taskId, {
    sceneJobId: initial.sceneJobId,
    imageFileName: initial.expectedImageFileName,
    codexJobId: jobArtifactId,
    revision: initial.revision,
    feedback: initial.feedback,
    preserveTaskStatus: true,
  });
  updateTask(taskId, { status: initial.returnStatus, currentGate: "ALL_IMAGES_CONFIRMATION" });
  updateJob(jobArtifactId, {
    status: "succeeded",
    phase: "completed",
    message: `分镜 ${initial.sceneJobId} 第 ${initial.revision} 版图片已写回，等待重新审核`,
    progress: 1,
    heartbeatAt: Date.now(),
    finishedAt: Date.now(),
    error: null,
  });
}

function launch(taskId: string, jobArtifactId: string) {
  if (runningJobs.has(jobArtifactId)) return;
  const promise = runJob(taskId, jobArtifactId)
    .catch((error: any) => {
      const artifact = getArtifactById(jobArtifactId);
      const initial = parseMeta(artifact?.meta);
      updateJob(jobArtifactId, {
        status: "failed",
        phase: "failed",
        message: "单张图片修改失败，可查看原因后重试",
        heartbeatAt: Date.now(),
        finishedAt: Date.now(),
        error: String(error?.message || error),
      });
      if (initial) updateTask(taskId, { status: initial.returnStatus, currentGate: "ALL_IMAGES_CONFIRMATION" });
    })
    .finally(() => runningJobs.delete(jobArtifactId));
  runningJobs.set(jobArtifactId, promise);
}

export function enqueueCodexImageRevision(taskId: string, sceneJobId: string, feedback: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  if (!["waiting_images_confirmation", "ready_for_post_production", "waiting_render_review"].includes(task.status)) {
    throw new Error("当前阶段不能修改分镜图片");
  }
  const { manifest } = manifestFor(taskId);
  const scene = (manifest.jobs || []).find((item: any) => item.id === sceneJobId);
  if (!scene || scene.status !== "done" || !scene.imagePath) throw new Error("只能修改已生成的分镜图片");
  const latest = getLatestCodexImageRevisionJobs(taskId).find((item) => item.meta.sceneJobId === sceneJobId);
  const revision = Math.max(2, Number(latest?.meta.revision || 1) + 1);
  const currentImagePath = path.resolve(path.join(taskDir(taskId), "..", ".."), scene.imagePath);
  if (!fs.existsSync(currentImagePath)) throw new Error("当前分镜图片文件不存在");
  const expectedImageFileName = nextVersionedName(scene.imageFileName, revision);
  const expectedPromptFileName = nextVersionedName(scene.promptFileName, revision);
  const meta: CodexImageRevisionJobMeta = {
    jobType: "image_revision",
    status: "queued",
    phase: "queued",
    message: `分镜 ${sceneJobId} 已进入单张修改队列`,
    progress: 0.03,
    sceneJobId,
    sceneLabel: String(scene.label || sceneJobId),
    revision,
    feedback: String(feedback || "").trim().slice(0, 1000),
    currentImagePath,
    expectedImageFileName,
    expectedPromptFileName,
    threadId: null,
    eventLogPath: null,
    returnStatus: "waiting_images_confirmation",
    createdAt: Date.now(),
    startedAt: null,
    heartbeatAt: Date.now(),
    finishedAt: null,
    error: null,
  };
  if (!meta.feedback) throw new Error("请先填写这张图片的修改意见");
  const jobArtifactId = saveArtifact({
    taskId,
    stepName: "storyboard",
    kind: "codex_job",
    label: `G04 ${sceneJobId} 单张图片修改任务`,
    meta,
  });
  updateTask(taskId, { status: "generating_image_revision", currentGate: "IMAGE_REVISION" });
  launch(taskId, jobArtifactId);
  return { job: { artifact: getArtifactById(jobArtifactId)!, meta } };
}
