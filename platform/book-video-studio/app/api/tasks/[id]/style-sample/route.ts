import { NextRequest, NextResponse } from "next/server";
import {
  getArtifacts,
  getTask,
  patchArtifact,
} from "@/lib/pipeline/repo";
import { enqueueCodexStyleSample, getLatestCodexStyleSampleJob } from "@/lib/codexStyleSampleJob";
import { enqueueCodexRemainingImages } from "@/lib/codexRemainingImagesJob";
import { registerStyleSampleFile } from "@/lib/styleSampleRegistry";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action === "enqueue" || action === "retry") {
    try {
      const result = enqueueCodexStyleSample(id, { force: action === "retry" });
      return NextResponse.json({
        ok: true,
        alreadyCompleted: result.alreadyCompleted,
        jobId: result.job?.artifact.id || null,
        job: result.job?.meta || null,
      });
    } catch (error: any) {
      return NextResponse.json({ error: String(error?.message || error) }, { status: 409 });
    }
  }

  if (action === "register") {
    try {
      const registered = registerStyleSampleFile(id, {
        imageFileName: String(body.imageFileName || ""),
        promptFileName: String(body.promptFileName || ""),
        prompt: String(body.prompt || ""),
        codexJobId: String(body.codexJobId || "") || undefined,
      });
      return NextResponse.json({ ok: true, ...registered });
    } catch (error: any) {
      const message = String(error?.message || error);
      const status = message.includes("必须存在") ? 400 : 409;
      return NextResponse.json({ error: message }, { status });
    }
  }

  if (action === "confirm") {
    if (task.status !== "waiting_style_confirmation") {
      return NextResponse.json({ error: "当前没有待确认的风格样图" }, { status: 409 });
    }
    const sample = getArtifacts(id).find(
      (item) => item.stepName === "storyboard" && item.kind === "style_sample",
    );
    if (!sample) return NextResponse.json({ error: "缺少风格样图产物" }, { status: 409 });
    const previousMeta = (() => {
      try { return sample.meta ? JSON.parse(sample.meta) : {}; }
      catch { return {}; }
    })();
    patchArtifact(sample.id, {
      meta: JSON.stringify({ ...previousMeta, approvedAt: Date.now() }),
    });
    const dispatched = enqueueCodexRemainingImages(id);
    return NextResponse.json({
      ok: true,
      nextGate: "REMAINING_IMAGES_GENERATING",
      queued: dispatched.manifest.jobs.length,
      codexJobId: dispatched.job.artifact.id,
      codexJob: dispatched.job.meta,
    });
  }

  return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getTask(id)) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const latest = getLatestCodexStyleSampleJob(id);
  return NextResponse.json({
    ok: true,
    jobId: latest?.artifact.id || null,
    job: latest?.meta || null,
  });
}
