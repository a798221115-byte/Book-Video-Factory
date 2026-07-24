import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  getArtifacts,
  getTask,
  patchArtifact,
  taskDir,
  updateTask,
} from "@/lib/pipeline/repo";
import { enqueueCodexRemainingImages } from "@/lib/codexRemainingImagesJob";
import { enqueueCodexImageRevision } from "@/lib/codexImageRevisionJob";
import { registerRemainingImageFile } from "@/lib/remainingImageRegistry";
import { parseArtifactMeta } from "@/lib/storyboardGeneration";

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
  try {
    const result = enqueueCodexRemainingImages(id);
    return NextResponse.json({
      ok: true,
      manifest: result.manifest,
      jobId: result.job.artifact.id,
      job: result.job.meta,
    });
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 409 });
  }
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

  if (action === "retry") {
    try {
      const result = enqueueCodexRemainingImages(id, { force: true });
      return NextResponse.json({
        ok: true,
        manifest: result.manifest,
        jobId: result.job.artifact.id,
        job: result.job.meta,
      });
    } catch (error: any) {
      return NextResponse.json({ error: String(error?.message || error) }, { status: 409 });
    }
  }

  if (action === "revise") {
    try {
      const sceneJobId = String(body.sceneJobId || "").trim();
      const feedback = String(body.feedback || "").trim().slice(0, 1000);
      if (!sceneJobId) return NextResponse.json({ error: "缺少分镜编号" }, { status: 400 });
      if (!feedback) return NextResponse.json({ error: "请先填写图片修改意见" }, { status: 400 });
      const result = enqueueCodexImageRevision(id, sceneJobId, feedback);
      return NextResponse.json({ ok: true, jobId: result.job.artifact.id, job: result.job.meta });
    } catch (error: any) {
      return NextResponse.json({ error: String(error?.message || error) }, { status: 409 });
    }
  }

  if (action === "register") {
    try {
      const result = registerRemainingImageFile(id, {
        sceneJobId: String(body.jobId || ""),
        imageFileName: String(body.imageFileName || ""),
        codexJobId: String(body.codexJobId || "") || undefined,
        revision: Number(body.revision || 1),
        feedback: String(body.feedback || ""),
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (error: any) {
      const message = String(error?.message || error);
      return NextResponse.json({ error: message }, { status: message.includes("必须存在") ? 400 : 409 });
    }
  }

  if (action === "sync") {
    if (!["waiting_images_confirmation", "ready_for_post_production", "waiting_render_review"].includes(task.status)) {
      return NextResponse.json({ error: "当前阶段不能同步分镜图片" }, { status: 409 });
    }
    let synced = 0;
    for (const scene of manifest.jobs || []) {
      if (scene.status !== "done") continue;
      const imageFileName = path.basename(String(scene.imageFileName || ""));
      const imagePath = path.resolve(taskDir(id), "storyboard", "images", imageFileName);
      if (!imageFileName || !fs.existsSync(imagePath) || fs.statSync(imagePath).size < 10_000) continue;
      registerRemainingImageFile(id, {
        sceneJobId: String(scene.id || ""),
        imageFileName,
        preserveTaskStatus: true,
      });
      synced += 1;
    }
    return NextResponse.json({ ok: true, synced, message: synced ? `已同步 ${synced} 张 Codex 图片` : "没有发现新的图片文件" });
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
