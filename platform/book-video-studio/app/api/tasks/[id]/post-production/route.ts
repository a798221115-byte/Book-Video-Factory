import { NextResponse } from "next/server";
import { getTask, setStepStatus, updateTask } from "@/lib/pipeline/repo";
import {
  lockedFemaleNarrationIsRunning,
  resetLockedFemaleNarration,
  startLockedFemaleNarration,
} from "@/lib/lockedFemaleNarration";
import {
  lockedFemalePostProductionIsRunning,
  startLockedFemalePostProduction,
} from "@/lib/lockedFemalePostProduction";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const retryStaleVoice = body?.retry === true;
  // A worker restart can leave the DB at generating_voice while the child
  // process and its in-memory lock are already gone. An explicit retry repairs
  // that state before starting a fresh locked job.
  if (retryStaleVoice) resetLockedFemaleNarration(id);
  if (retryStaleVoice && task.status === "generating_voice") {
    setStepStatus(id, "tts", {
      status: "pending",
      progress: 0,
      error: "",
    });
    updateTask(id, { status: "ready_for_post_production", currentGate: "POST_PRODUCTION" });
  }

  if (lockedFemalePostProductionIsRunning(id)) {
    return NextResponse.json({ ok: true, alreadyRunning: true, phase: "post-production" });
  }
  if (task.status === "waiting_voice_confirmation") {
    startLockedFemalePostProduction(id).catch((error) =>
      console.error("[locked-female-post-production]", error),
    );
    return NextResponse.json({
      ok: true,
      phase: "post-production",
      nextGate: "CAPTIONS_GENERATING",
    });
  }
  if (lockedFemaleNarrationIsRunning(id) && !retryStaleVoice) {
    setStepStatus(id, "tts", { status: "running", error: "" });
    updateTask(id, { status: "generating_voice", currentGate: "VOICE_GENERATING" });
    return NextResponse.json({ ok: true, alreadyRunning: true, variant: "female" });
  }
  const currentTask = getTask(id) || task;
  if (currentTask.status === "generating_voice") {
    return NextResponse.json(
      { error: "女声任务状态仍在运行，但生成进程不存在，请点击重试" },
      { status: 409 },
    );
  }
  if (!["ready_for_post_production", "voice_failed", "post_production_failed"].includes(currentTask.status)) {
    return NextResponse.json({ error: "当前阶段不能启动女声后期" }, { status: 409 });
  }
  if (currentTask.status === "post_production_failed") {
    startLockedFemalePostProduction(id).catch((error) =>
      console.error("[locked-female-post-production]", error),
    );
    return NextResponse.json({
      ok: true,
      phase: "post-production",
      nextGate: "CAPTIONS_GENERATING",
    });
  }
  startLockedFemaleNarration(id).catch((error: any) => {
    const message = String(error?.message || error);
    setStepStatus(id, "tts", { status: "failed", error: message, finishedAt: Date.now() });
    updateTask(id, { status: "voice_failed", currentGate: "VOICE_GENERATION_FAILED" });
    console.error("[locked-female-narration]", error);
  });
  return NextResponse.json({
    ok: true,
    variant: "female",
    preset: "female-book-narrator-locked-v1",
    nextGate: "VOICE_GENERATING",
  });
}
