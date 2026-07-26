import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getArtifacts,
  getTask,
  patchArtifact,
  projectArtifactPath,
  saveArtifact,
  taskDir,
  updateTask,
} from "./pipeline/repo";
import { assertTitleWorkflowComplete } from "./titleWorkflow";
import { enqueueCodexRemainingImages } from "./codexRemainingImagesJob";

function fileSha256(filePath: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function registerStyleSampleFile(
  taskId: string,
  input: {
    imageFileName: string;
    promptFileName?: string;
    prompt?: string;
    codexJobId?: string;
    revision?: number;
    feedback?: string;
  },
) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  assertTitleWorkflowComplete(taskId);
  if (![
    "ready_for_style_sample",
    "generating_style_sample",
    "waiting_style_confirmation",
  ].includes(task.status)) {
    throw new Error("当前阶段不能登记风格样图");
  }

  const allowedRoot = path.resolve(taskDir(taskId), "storyboard", "images");
  const imageFileName = path.basename(String(input.imageFileName || ""));
  const imagePath = path.resolve(allowedRoot, imageFileName);
  if (!imagePath.startsWith(allowedRoot + path.sep) || !fs.existsSync(imagePath)) {
    throw new Error("样图必须存在于当前任务 storyboard/images 目录");
  }

  const promptFileName = path.basename(String(input.promptFileName || ""));
  const promptPath = promptFileName
    ? path.resolve(taskDir(taskId), "storyboard", "prompts", promptFileName)
    : "";
  const prompt = promptPath &&
    promptPath.startsWith(path.resolve(taskDir(taskId)) + path.sep) &&
    fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, "utf8")
    : String(input.prompt || "");
  const storedPath = projectArtifactPath(imagePath);
  const existing = getArtifacts(taskId).find(
    (item) => item.stepName === "storyboard" && item.kind === "style_sample",
  );
  const meta = {
    generatedBy: "codex-sdk-imagegen",
    codexJobId: input.codexJobId || null,
    prompt,
    promptPath: promptPath && fs.existsSync(promptPath) ? projectArtifactPath(promptPath) : null,
    sha256: fileSha256(imagePath),
    approvalRequired: false,
    approvedAt: Date.now(),
    approvalMode: "automatic",
    revision: Number(input.revision || 1),
    feedback: String(input.feedback || ""),
    registeredAt: Date.now(),
  };

  if (existing) {
    patchArtifact(existing.id, {
      label: "G03 Codex 风格样图",
      path: storedPath,
      meta: JSON.stringify(meta),
    });
  } else {
    saveArtifact({
      taskId,
      stepName: "storyboard",
      kind: "style_sample",
      label: "G03 Codex 风格样图",
      path: storedPath,
      meta,
    });
  }
  const dispatched = enqueueCodexRemainingImages(taskId);
  return {
    path: storedPath,
    sha256: meta.sha256,
    autoApproved: true,
    queued: dispatched.manifest.jobs.length,
    codexJobId: dispatched.job.artifact.id,
  };
}

export function replaceConfirmedStyleSampleFile(
  taskId: string,
  input: {
    imageFileName: string;
    promptFileName?: string;
    prompt?: string;
    revision: number;
    feedback?: string;
  },
) {
  const task = getTask(taskId);
  if (!task) throw new Error("浠诲姟涓嶅瓨鍦?");
  assertTitleWorkflowComplete(taskId);
  if (!["waiting_images_confirmation", "ready_for_post_production", "waiting_render_review"].includes(task.status)) {
    throw new Error("褰撳墠闃舵涓嶈兘鏇存崲宸茬‘璁ょ殑 G03 鏍峰浘");
  }

  const allowedRoot = path.resolve(taskDir(taskId), "storyboard", "images");
  const imageFileName = path.basename(String(input.imageFileName || ""));
  const imagePath = path.resolve(allowedRoot, imageFileName);
  if (!imagePath.startsWith(allowedRoot + path.sep) || !fs.existsSync(imagePath)) {
    throw new Error("鏂扮殑 G03 鏍峰浘蹇呴』瀛樺湪浜庡綋鍓嶄换鍔?storyboard/images 鐩綍");
  }

  const promptFileName = path.basename(String(input.promptFileName || ""));
  const promptPath = promptFileName
    ? path.resolve(taskDir(taskId), "storyboard", "prompts", promptFileName)
    : "";
  const prompt = promptPath &&
    promptPath.startsWith(path.resolve(taskDir(taskId)) + path.sep) &&
    fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, "utf8")
    : String(input.prompt || "");
  const existing = getArtifacts(taskId).find(
    (item) => item.stepName === "storyboard" && item.kind === "style_sample",
  );
  if (!existing) throw new Error("缂哄皯褰撳墠 G03 椋庢牸鏍峰浘浜х墿");

  const storedPath = projectArtifactPath(imagePath);
  const meta = {
    generatedBy: "codex-sdk-imagegen",
    codexJobId: null,
    prompt,
    promptPath: promptPath && fs.existsSync(promptPath) ? projectArtifactPath(promptPath) : null,
    sha256: fileSha256(imagePath),
    approvalRequired: false,
    revision: Number(input.revision || 1),
    feedback: String(input.feedback || ""),
    replacedAt: Date.now(),
    approvedAt: Date.now(),
  };
  patchArtifact(existing.id, {
    label: "G03 Codex 椋庢牸鏍峰浘",
    path: storedPath,
    meta: JSON.stringify(meta),
  });
  updateTask(taskId, {
    status: "ready_for_remaining_images",
    currentGate: "REMAINING_IMAGES_CONFIRMATION",
  });
  return { path: storedPath, sha256: meta.sha256, revision: meta.revision };
}
