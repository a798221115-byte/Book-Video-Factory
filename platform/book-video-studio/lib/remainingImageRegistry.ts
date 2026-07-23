import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getArtifacts,
  getTask,
  patchArtifact,
  projectArtifactPath,
  saveArtifact,
  setStepStatus,
  taskDir,
  updateTask,
} from "./pipeline/repo";
import { parseArtifactMeta } from "./storyboardGeneration";

function fileSha256(filePath: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function registerRemainingImageFile(
  taskId: string,
  input: { sceneJobId: string; imageFileName?: string; codexJobId?: string },
) {
  if (!getTask(taskId)) throw new Error("任务不存在");
  const manifestArtifact = getArtifacts(taskId).find(
    (item) => item.stepName === "storyboard" && item.kind === "remaining_image_manifest",
  );
  if (!manifestArtifact) throw new Error("剩余分镜生图队列不存在");
  const manifest = parseArtifactMeta(manifestArtifact.meta);
  const sceneJobId = String(input.sceneJobId || "");
  const sceneJob = (manifest.jobs || []).find((item: any) => item.id === sceneJobId);
  if (!sceneJob) throw new Error("未知分镜任务");

  const imageRoot = path.resolve(taskDir(taskId), "storyboard", "images");
  const imageFileName = path.basename(String(input.imageFileName || sceneJob.imageFileName || ""));
  const imagePath = path.resolve(imageRoot, imageFileName);
  if (!imagePath.startsWith(imageRoot + path.sep) || !fs.existsSync(imagePath)) {
    throw new Error("图片必须存在于当前任务 storyboard/images 目录");
  }
  const storedPath = projectArtifactPath(imagePath);
  const sha256 = fileSha256(imagePath);
  const existingImage = getArtifacts(taskId).find(
    (item) => item.stepName === "storyboard" &&
      item.kind === "storyboard_image" &&
      parseArtifactMeta(item.meta).jobId === sceneJobId,
  );
  const imageMeta = {
    jobId: sceneJobId,
    codexJobId: input.codexJobId || null,
    generatedBy: "codex-sdk-imagegen",
    sha256,
    registeredAt: Date.now(),
  };
  if (existingImage) {
    patchArtifact(existingImage.id, {
      label: `G04 ${sceneJobId} ${sceneJob.label}`,
      path: storedPath,
      meta: JSON.stringify(imageMeta),
    });
  } else {
    saveArtifact({
      taskId,
      stepName: "storyboard",
      kind: "storyboard_image",
      label: `G04 ${sceneJobId} ${sceneJob.label}`,
      path: storedPath,
      meta: imageMeta,
    });
  }
  sceneJob.status = "done";
  sceneJob.imagePath = storedPath;
  sceneJob.sha256 = sha256;
  sceneJob.error = null;
  const completed = manifest.jobs.filter((item: any) => item.status === "done").length;
  const allDone = completed === manifest.jobs.length;
  manifest.status = allDone ? "done" : "running";
  manifest.updatedAt = Date.now();
  patchArtifact(manifestArtifact.id, { meta: JSON.stringify(manifest) });
  setStepStatus(taskId, "images", {
    status: allDone ? "done" : "running",
    progress: manifest.jobs.length ? completed / manifest.jobs.length : 1,
    finishedAt: allDone ? Date.now() : undefined,
    error: "",
  });
  updateTask(taskId, {
    status: allDone ? "waiting_images_confirmation" : "generating_remaining_images",
    currentGate: allDone ? "ALL_IMAGES_CONFIRMATION" : "REMAINING_IMAGES_GENERATING",
  });
  return { completed, total: manifest.jobs.length, allDone, path: storedPath };
}
