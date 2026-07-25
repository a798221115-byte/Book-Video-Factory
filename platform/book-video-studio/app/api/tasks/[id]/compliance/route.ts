import { NextResponse } from "next/server";
import { enqueueComplianceAudit } from "@/lib/complianceWorkflow";
import { getTask } from "@/lib/pipeline/repo";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const scope = body.scope === "media" ? "media" : "text";
  enqueueComplianceAudit(id, scope);
  return NextResponse.json({ ok: true, scope, queued: true });
}
