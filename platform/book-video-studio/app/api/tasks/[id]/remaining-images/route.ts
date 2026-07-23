import { NextRequest, NextResponse } from "next/server";
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
} from "@/lib/pipeline/repo";
import { parseArtifactMeta, startRemainingImageQueue } from "@/lib/storyboardGeneration";

function fileSha256(filePath: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (![
    "ready_for_remaining_images",
    "generating_remaining_images",
    "waiting_images_confirmation",
    "ready_for_post_production",
  ].includes(task.status)) {
    return NextResponse.json({ error: "当前阶段不能启动剩余分镜生图" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, manifest: startRemainingImageQueue(id) });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const manifestArtifact = getArtifacts(id).find(
    (item) => item.stepName === "storyboard" && item.kind === "remaining_image_manifest",
  );
  if (!manifestArtifact) return NextResponse.json({ error: "剩余分镜生图队列不存在" }, { status: 409 });
  const manifest = parseArtifactMeta(manifestArtifact.meta);

  if (action === "register") {
    const jobId = String(body.jobId || "");
    const job = (manifest.jobs || []).find((item: any) => item.id === jobId);
    if (!job) return NextResponse.json({ error: "未知分镜任务" }, { status: 400 });
    const imageRoot = path.resolve(taskDir(id), "storyboard", "images");
    const imageFileName = path.basename(String(body.imageFileName || job.imageFileName || ""));
    const imagePath = path.resolve(imageRoot, imageFileName);
    if (!imagePath.startsWith(imageRoot + path.sep) || !fs.existsSync(imagePath)) {
      return NextResponse.json({ error: "图片必须存在于当前任务 storyboard/images 目录" }, { status: 400 });
    }
    const storedPath = projectArtifactPath(imagePath);
    const sha256 = fileSha256(imagePath);
    const existingImage = getArtifacts(id).find(
      (item) => item.stepName === "storyboard" && item.kind === "storyboard_image" &&
        parseArtifactMeta(item.meta).jobId === jobId,
    );
    const imageMeta = { jobId, generatedBy: "codex-built-in-imagegen", sha256, registeredAt: Date.now() };
    if (existingImage) {
      patchArtifact(existingImage.id, {
        label: `G04 ${jobId} ${job.label}`,
        path: storedPath,
        meta: JSON.stringify(imageMeta),
      });
    } else {
      saveArtifact({
        taskId: id,
        stepName: "storyboard",
        kind: "storyboard_image",
        label: `G04 ${jobId} ${job.label}`,
        path: storedPath,
        meta: imageMeta,
      });
    }
    job.status = "done";
    job.imagePath = storedPath;
    job.sha256 = sha256;
    job.error = null;
    const completed = manifest.jobs.filter((item: any) => item.status === "done").length;
    const allDone = completed === manifest.jobs.length;
    manifest.status = allDone ? "done" : "running";
    manifest.updatedAt = Date.now();
    patchArtifact(manifestArtifact.id, { meta: JSON.stringify(manifest) });
    setStepStatus(id, "images", {
      status: allDone ? "done" : "running",
      progress: completed / manifest.jobs.length,
      finishedAt: allDone ? Date.now() : undefined,
      error: "",
    });
    updateTask(id, {
      status: allDone ? "waiting_images_confirmation" : "generating_remaining_images",
      currentGate: allDone ? "ALL_IMAGES_CONFIRMATION" : "REMAINING_IMAGES_GENERATING",
    });
    return NextResponse.json({ ok: true, completed, total: manifest.jobs.length, allDone, path: storedPath });
  }

  if (action === "confirm_all") {
    if ((manifest.jobs || []).some((item: any) => item.status !== "done")) {
      return NextResponse.json({ error: "仍有分镜图片未完成，不能确认全部图片" }, { status: 409 });
    }
    manifest.approvedAt = Date.now();
    patchArtifact(manifestArtifact.id, { meta: JSON.stringify(manifest) });
    updateTask(id, { status: "ready_for_post_production", currentGate: "POST_PRODUCTION" });
    return NextResponse.json({ ok: true, nextGate: "POST_PRODUCTION" });
  }

  return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
}
