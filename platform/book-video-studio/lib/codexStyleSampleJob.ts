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
import { registerStyleSampleFile } from "./styleSampleRegistry";
import { assertTitleWorkflowComplete } from "./titleWorkflow";
import { runVisibleCodexTask, type CodexTaskEvent } from "./codexAppServer";

export type CodexStyleSampleJobStatus =
  | "queued"
  | "starting"
  | "running"
  | "succeeded"
  | "failed";

export type CodexStyleSampleJobMeta = {
  jobType: "style_sample";
  status: CodexStyleSampleJobStatus;
  phase: string;
  message: string;
  progress: number;
  threadId: string | null;
  expectedImageFileName: string;
  expectedPromptFileName: string;
  eventLogPath: string | null;
  createdAt: number;
  startedAt: number | null;
  heartbeatAt: number | null;
  finishedAt: number | null;
  error: string | null;
};

function parseMeta(raw: string | null | undefined): CodexStyleSampleJobMeta | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value?.jobType === "style_sample" ? value : null;
  } catch {
    return null;
  }
}

export function getLatestCodexStyleSampleJob(taskId: string) {
  return getArtifacts(taskId)
    .filter((item) => item.stepName === "storyboard" && item.kind === "codex_job")
    .map((artifact) => ({ artifact, meta: parseMeta(artifact.meta) }))
    .filter((item): item is { artifact: typeof item.artifact; meta: CodexStyleSampleJobMeta } => Boolean(item.meta))
    .sort((a, b) => b.artifact.createdAt - a.artifact.createdAt)[0] || null;
}

const runningJobs = new Map<string, Promise<void>>();

function updateJob(jobArtifactId: string, patch: Partial<CodexStyleSampleJobMeta>) {
  const artifact = getArtifactById(jobArtifactId);
  const current = parseMeta(artifact?.meta);
  if (!artifact || !current) throw new Error("Codex 任务记录不存在");
  const next = { ...current, ...patch };
  patchArtifact(jobArtifactId, { meta: JSON.stringify(next) });
  return next;
}

function summarizeEvent(event: CodexTaskEvent) {
  if (event.type === "thread.started") {
    return { phase: "thread_created", message: "Codex 任务已创建，正在读取文案与标题", progress: 0.12 };
  }
  if (event.type === "turn.started") {
    return { phase: "planning", message: "Codex 正在规划分镜与代表性画面", progress: 0.2 };
  }
  if (event.type === "item.started") {
    const item = event.item as any;
    if (item.type === "mcpToolCall" || item.type === "mcp_tool_call" || item.type === "image_generation") {
      return { phase: "generating_image", message: "Codex imagegen 正在生成代表性样图", progress: 0.55 };
    }
    if (item.type === "commandExecution" || item.type === "command_execution") {
      return { phase: "saving", message: "Codex 正在整理并保存 G03 产物", progress: 0.72 };
    }
    return { phase: "working", message: "Codex 正在执行 G03 风格样图任务", progress: 0.38 };
  }
  if (event.type === "item.completed") {
    const item = event.item as any;
    if (item.type === "agentMessage" || item.type === "agent_message") {
      return { phase: "verifying", message: "Codex 已完成生成，正在核验并写回工作台", progress: 0.88 };
    }
    if (
      item.type === "fileChange" ||
      item.type === "file_change" ||
      item.type === "commandExecution" ||
      item.type === "command_execution"
    ) {
      return { phase: "saving", message: "样图文件正在写入当前项目", progress: 0.78 };
    }
  }
  if (event.type === "turn.completed") {
    return { phase: "registering", message: "Codex 任务已完成，正在登记 G03 样图", progress: 0.94 };
  }
  return null;
}

function buildPrompt(taskId: string, imageFileName: string, promptFileName: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  const projectDir = taskDir(taskId);
  const imagePath = path.join(projectDir, "storyboard", "images", imageFileName);
  const promptPath = path.join(projectDir, "storyboard", "prompts", promptFileName);
  return [
    `【Book Video Studio｜G03 风格样图｜${task.bookTitle || taskId}】`,
    `你正在执行工作台自动派发的 G03 风格样图任务。任务 ID：${taskId}。`,
    "",
    "严格执行以下要求：",
    "1. 先完整阅读当前项目的 AGENTS.md，以及该任务目录中的 script.txt、titles.json、script_sources.md（如存在）。",
    "2. 依据已确认文案按语义生成 storyboard/storyboard.json；图片数量由语义自然决定，不使用固定数量公式。",
    "3. 只选择一个最有代表性的镜头作为 G03 样图，写出对应提示词。",
    "4. 必须使用内置 image_gen/imagegen 能力生成恰好一张 9:16 竖屏样图；不得生成其余分镜图片。",
    "5. 图片无中文、无英文、无书名、无字幕、无标志、无水印；为顶部标题和中下部字幕保留自然低信息区。",
    "6. 样图必须保存到下面指定的绝对路径；提示词必须保存到指定提示词路径。",
    `7. 图片路径：${imagePath}`,
    `8. 提示词路径：${promptPath}`,
    "9. 完成后检查图片文件确实存在、可读取，并在最终回复中明确写出保存路径。",
    "10. 不进入 G04，不生成配音、字幕、视频、剪映草稿、封面，不发布，不归档。",
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
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  const artifact = getArtifactById(jobArtifactId);
  const initial = parseMeta(artifact?.meta);
  if (!artifact || !initial) throw new Error("Codex 任务记录不存在");

  const logDir = path.join(taskDir(taskId), "storyboard", "codex-jobs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${jobArtifactId}.jsonl`);
  updateJob(jobArtifactId, {
    status: "starting",
    phase: "starting",
    message: "正在启动本地 Codex 任务",
    progress: 0.08,
    startedAt: initial.startedAt || Date.now(),
    heartbeatAt: Date.now(),
    eventLogPath: projectArtifactPath(logPath),
    error: null,
  });
  updateTask(taskId, {
    status: "generating_style_sample",
    currentGate: "STYLE_SAMPLE_GENERATING",
  });

  const projectRoot = path.resolve(path.join(taskDir(taskId), "..", ".."));
  const prompt = buildPrompt(taskId, initial.expectedImageFileName, initial.expectedPromptFileName);
  await runVisibleCodexTask({
    title: `Book Video Studio｜G03 风格样图｜${task.bookTitle || taskId}`,
    prompt,
    projectRoot,
    existingThreadId: initial.threadId,
    onEvent: async (event) => {
      appendEvent(logPath, event.raw);
      const summary = summarizeEvent(event);
      updateJob(jobArtifactId, {
        status: "running",
        threadId: event.type === "thread.started" ? event.thread_id : undefined,
        heartbeatAt: Date.now(),
        ...(summary || {}),
      });
    },
  });

  const imagePath = path.join(
    taskDir(taskId),
    "storyboard",
    "images",
    initial.expectedImageFileName,
  );
  if (!fs.existsSync(imagePath) || fs.statSync(imagePath).size < 10_000) {
    throw new Error(`Codex 任务结束，但没有在指定位置找到有效样图：${imagePath}`);
  }
  registerStyleSampleFile(taskId, {
    imageFileName: initial.expectedImageFileName,
    promptFileName: initial.expectedPromptFileName,
    codexJobId: jobArtifactId,
  });
  updateJob(jobArtifactId, {
    status: "succeeded",
    phase: "completed",
    message: "G03 样图已生成并自动写回工作台，等待你的风格确认",
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
      updateJob(jobArtifactId, {
        status: "failed",
        phase: "failed",
        message: "Codex G03 任务失败，可在工作台查看原因并重试",
        heartbeatAt: Date.now(),
        finishedAt: Date.now(),
        error: String(error?.message || error),
      });
      updateTask(taskId, {
        status: "ready_for_style_sample",
        currentGate: "STYLE_SAMPLE",
      });
    })
    .finally(() => runningJobs.delete(jobArtifactId));
  runningJobs.set(jobArtifactId, promise);
}

export function enqueueCodexStyleSample(taskId: string, options: { force?: boolean } = {}) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  assertTitleWorkflowComplete(taskId);
  const sample = getArtifacts(taskId).find(
    (item) => item.stepName === "storyboard" && item.kind === "style_sample",
  );
  if (sample && !options.force) {
    return { job: getLatestCodexStyleSampleJob(taskId), alreadyCompleted: true };
  }

  const latest = getLatestCodexStyleSampleJob(taskId);
  if (!options.force && latest && ["queued", "starting", "running", "succeeded"].includes(latest.meta.status)) {
    if (["queued", "starting", "running"].includes(latest.meta.status)) {
      launch(taskId, latest.artifact.id);
    }
    return { job: latest, alreadyCompleted: latest.meta.status === "succeeded" };
  }

  const now = Date.now();
  const meta: CodexStyleSampleJobMeta = {
    jobType: "style_sample",
    status: "queued",
    phase: "queued",
    message: "G03 已进入 Codex 队列",
    progress: 0.03,
    threadId: null,
    expectedImageFileName: "style-sample-v1.png",
    expectedPromptFileName: "style-sample-v1.txt",
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
    label: "G03 Codex 自动生图任务",
    meta,
  });
  updateTask(taskId, {
    status: "generating_style_sample",
    currentGate: "STYLE_SAMPLE_GENERATING",
  });
  launch(taskId, jobArtifactId);
  return {
    job: { artifact: getArtifactById(jobArtifactId)!, meta },
    alreadyCompleted: false,
  };
}
