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
    approvalRequired: true,
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
  updateTask(taskId, {
    status: "waiting_style_confirmation",
    currentGate: "STYLE_SAMPLE_CONFIRMATION",
  });
  return { path: storedPath, sha256: meta.sha256 };
}
