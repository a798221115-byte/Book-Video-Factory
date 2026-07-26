import { NextResponse } from "next/server";
import { generateDeliveryCover, recordDeliveryCoverFailure } from "@/lib/deliveryCover";
import { getTask } from "@/lib/pipeline/repo";

const ALLOWED_STATUSES = new Set([
  "rendering_video",
  "media_compliance_queued",
  "media_compliance_failed",
  "media_compliance_blocked",
  "waiting_render_review",
  "done",
  "ready_for_draft_upload",
  "draft_upload_failed",
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (!ALLOWED_STATUSES.has(task.status)) {
    return NextResponse.json({
      error: "独立封面只能在成片渲染完成后生成",
      currentStatus: task.status,
    }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  try {
    const result = await generateDeliveryCover(id, {
      headline1: String(body.headline1 || ""),
      headline2: String(body.headline2 || ""),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    const detail = recordDeliveryCoverFailure(id, error);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
