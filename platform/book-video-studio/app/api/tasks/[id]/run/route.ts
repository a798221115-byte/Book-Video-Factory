import { NextRequest, NextResponse } from "next/server";
import { ensureRegistered } from "@/lib/pipeline/register";
import { runStep, rerunStep, runPipeline } from "@/lib/pipeline/runner";
import { getSteps } from "@/lib/pipeline/repo";
import type { StepName } from "@/lib/pipeline/steps";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureRegistered();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const { action, step } = body as { action: "run" | "rerun" | "pipeline"; step?: StepName };
  const allowedSteps = new Set<StepName>(["extract", "transcribe", "analyze"]);

  try {
    if (action === "pipeline") {
      // 异步跑，不阻塞响应；前端轮询/SSE 看状态
      runPipeline(id).catch((e) => console.error("[pipeline]", e));
    } else if (action === "rerun" && step && allowedSteps.has(step)) {
      rerunStep(id, step)
        .then(() => runPipeline(id))
        .catch((e) => console.error("[rerun-pipeline]", e));
    } else if (action === "run" && step && allowedSteps.has(step)) {
      runStep(id, step).catch((e) => console.error("[run]", e));
    } else {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, steps: getSteps(id).map(s => ({ name: s.name, status: s.status })) });
}
