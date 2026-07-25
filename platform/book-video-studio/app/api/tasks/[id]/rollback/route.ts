import { NextResponse } from "next/server";
import {
  ROLLBACK_TARGETS,
  rollbackImpact,
  rollbackWorkflow,
  type RollbackTarget,
} from "@/lib/workflowRollback";

function validTarget(value: unknown): value is RollbackTarget {
  return ROLLBACK_TARGETS.includes(value as RollbackTarget);
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const target = new URL(req.url).searchParams.get("target");
  if (!validTarget(target)) {
    return NextResponse.json({ error: "不支持的回退节点" }, { status: 400 });
  }
  try {
    return NextResponse.json(rollbackImpact(id, target));
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 404 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const target = body.target;
  if (!validTarget(target)) {
    return NextResponse.json({ error: "不支持的回退节点" }, { status: 400 });
  }
  if (body.confirmImpact !== true) {
    return NextResponse.json({
      error: "请先确认回退影响",
      ...rollbackImpact(id, target),
    }, { status: 409 });
  }
  try {
    return NextResponse.json(rollbackWorkflow(
      id,
      target,
      String(body.reason || "用户从工作台返回修改").slice(0, 300),
    ));
  } catch (error: any) {
    const message = String(error?.message || error);
    return NextResponse.json(
      { error: message },
      { status: message.includes("仍在执行") ? 409 : 500 },
    );
  }
}
