import { NextResponse } from "next/server";
import { getTask, updateTaskNotes } from "@/lib/pipeline/repo";
import { revalidatePath } from "next/cache";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getTask(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const rawNotes = typeof body.notes === "string" ? body.notes.trim() : "";
  const task = updateTaskNotes(id, rawNotes || null);
  revalidatePath("/");
  return NextResponse.json({ ok: true, task });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getTask(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    error: "第一版已禁用任务删除，以保护 work/ 生产文件和审计记录。",
  }, { status: 405 });
}
