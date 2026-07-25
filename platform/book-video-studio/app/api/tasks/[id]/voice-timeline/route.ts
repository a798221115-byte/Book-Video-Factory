import { NextResponse } from "next/server";
import { startLockedFemaleNarration } from "@/lib/lockedFemaleNarration";
import { getStep, getTask, upsertWorkflowRun } from "@/lib/pipeline/repo";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (getStep(id, "text_compliance")?.status !== "done") {
    return NextResponse.json({ error: "C01 文案合规初审尚未通过" }, { status: 409 });
  }
  upsertWorkflowRun(id, "voice_timeline", {
    status: "queued", progress: 0, message: "提前配音已重新排队", error: null,
  });
  startLockedFemaleNarration(id, { early: true, continuePostProduction: false })
    .then(() => upsertWorkflowRun(id, "voice_timeline", {
      status: "succeeded", progress: 1, message: "真实配音时间轴已生成", finishedAt: Date.now(),
    }))
    .catch((error: any) => upsertWorkflowRun(id, "voice_timeline", {
      status: "failed", progress: 0, message: "提前配音失败，可重试",
      error: String(error?.message || error), finishedAt: Date.now(),
    }));
  return NextResponse.json({ ok: true, queued: true, message: "V01 提前配音与真实时间轴已排队" });
}
