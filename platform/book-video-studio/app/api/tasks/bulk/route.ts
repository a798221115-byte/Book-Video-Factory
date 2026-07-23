import { NextRequest, NextResponse } from "next/server";
import { getSteps, stopRunningTask } from "@/lib/pipeline/repo";
import { ensureRegistered } from "@/lib/pipeline/register";
import { runPipeline, rerunStep } from "@/lib/pipeline/runner";
import type { StepName } from "@/lib/pipeline/steps";
import { revalidatePath } from "next/cache";

const queue: Promise<void> = ((globalThis as any).__bulkTaskQueue ??= Promise.resolve());

function normalizeIds(body: any): string[] {
  return Array.isArray(body.ids)
    ? body.ids.map((id: unknown) => String(id || "").trim()).filter(Boolean)
    : [];
}

function enqueueBulk(work: () => Promise<void>) {
  const previous = (globalThis as any).__bulkTaskQueue || queue;
  const next = previous.then(work, work);
  (globalThis as any).__bulkTaskQueue = next.catch(() => {});
  return next;
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = normalizeIds(body);
  if (!ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
  return NextResponse.json({
    error: "第一版已禁用批量删除，以保护 work/ 生产文件和审计记录。",
  }, { status: 405 });
}

export async function POST(req: NextRequest) {
  ensureRegistered();
  const body = await req.json().catch(() => ({}));
  const ids = normalizeIds(body);
  const action = String(body.action || "");
  if (!ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 });

  if (action === "stop") {
    const stopped = ids.reduce<number>((sum, id) => sum + stopRunningTask(id), 0);
    revalidatePath("/");
    return NextResponse.json({ ok: true, stopped });
  }

  if (!["pipeline", "retry-failed"].includes(action)) {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }

  enqueueBulk(async () => {
    for (const id of ids) {
      try {
        if (action === "pipeline") await runPipeline(id);
        else if (action === "retry-failed") {
          const failed = getSteps(id).find((item) => item.status === "failed");
          if (failed) await rerunStep(id, failed.name as StepName);
          else await runPipeline(id);
        }
      } catch (error) {
        console.error("[bulk]", id, action, error);
      }
    }
  });

  return NextResponse.json({ ok: true, queued: ids.length, action, concurrency: 1 });
}
