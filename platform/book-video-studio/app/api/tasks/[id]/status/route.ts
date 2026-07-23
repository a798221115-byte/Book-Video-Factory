import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getTask, getSteps, getArtifacts, ensureSteps } from "@/lib/pipeline/repo";
import { reapZombieSteps } from "@/lib/pipeline/runner";

function shortHash(value: string | null) {
  if (!value) return "";
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  ensureSteps(id);      // 老任务补齐新增的可选步骤行（如 images）
  reapZombieSteps(id);  // 复位上次进程崩溃残留的 running 步骤（DB running 但内存锁无）
  return NextResponse.json({
    task,
    steps: getSteps(id),
    artifacts: getArtifacts(id).map(a => ({
      id: a.id,
      stepName: a.stepName,
      kind: a.kind,
      label: a.label,
      path: a.path,
      content: a.content,
      meta: a.meta,
      createdAt: a.createdAt,
      contentSig: shortHash(a.content || null),
      metaSig: shortHash(a.meta || null),
    })),
  });
}
