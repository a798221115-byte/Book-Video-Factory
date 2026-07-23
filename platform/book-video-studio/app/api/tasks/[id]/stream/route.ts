import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { getTask, getSteps, getArtifacts, ensureSteps } from "@/lib/pipeline/repo";
import { reapZombieSteps } from "@/lib/pipeline/runner";

export const dynamic = "force-dynamic";

const STREAM_CONTENT_MAX_CHARS = 8_000;
const STREAM_META_MAX_CHARS = 12_000;

function shortHash(value: string | null) {
  if (!value) return "";
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function compactArtifact(a: ReturnType<typeof getArtifacts>[number]) {
  const content = a.content ?? null;
  const meta = a.meta ?? null;
  const item: any = {
    id: a.id,
    stepName: a.stepName,
    kind: a.kind,
    label: a.label,
    path: a.path,
    createdAt: a.createdAt,
    contentLength: content?.length || 0,
    metaLength: meta?.length || 0,
    contentSig: shortHash(content),
    metaSig: shortHash(meta),
  };
  if (!content || content.length <= STREAM_CONTENT_MAX_CHARS) item.content = content;
  else item.contentMissing = true;
  if (!meta || meta.length <= STREAM_META_MAX_CHARS) item.meta = meta;
  else item.metaMissing = true;
  return item;
}

/**
 * SSE 流式进度（参考文章 app/api/tasks/[id]/stream/route.ts）。
 * 服务端轮询 SQLite，仅在 task/steps/artifacts 发生变化时推一帧 `event: state`，
 * 客户端用 EventSource 单条长连接代替原来的 1.5s 整页轮询，更省请求、即时刷新。
 * 任务进入终态（done/failed 且无 running 步骤）后再推一帧并发 `event: end`，客户端断开。
 */
function buildPayload(id: string) {
  const task = getTask(id);
  if (!task) return null;
  ensureSteps(id);
  reapZombieSteps(id);
  return {
    task,
    steps: getSteps(id),
    artifacts: getArtifacts(id).map(compactArtifact),
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getTask(id)) {
    return new Response('event: error\ndata: {"error":"not found"}\n\n', {
      status: 404,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      let lastSig = "";

      const finish = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try { controller.close(); } catch {}
      };

      const tick = () => {
        if (closed) return;
        let payload: ReturnType<typeof buildPayload>;
        try {
          payload = buildPayload(id);
        } catch {
          // 读库瞬时错误：跳过本帧，下个 tick 再试
          return;
        }
        if (!payload) { finish(); return; }

        const sig = JSON.stringify({
          ts: payload.task.status,
          s: payload.steps.map((s: any) => [s.name, s.status, s.progress]),
          a: payload.artifacts.map((a: any) => [
            a.id,
            a.contentSig || "",
            a.metaSig || "",
            a.path || "",
          ]),
        });
        if (sig !== lastSig) {
          lastSig = sig;
          try {
            controller.enqueue(enc.encode(`event: state\ndata: ${JSON.stringify(payload)}\n\n`));
          } catch { finish(); return; }
        }

        // 终态判定：无 running 且 task 已 done/failed → 收尾
        const anyRunning = payload.steps.some((s: any) => s.status === "running");
        if (!anyRunning && (payload.task.status === "done" || payload.task.status === "failed")) {
          try { controller.enqueue(enc.encode("event: end\ndata: {}\n\n")); } catch {}
          finish();
        }
      };

      // 立即推一帧，再每秒轮询
      tick();
      timer = setInterval(tick, 1000);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
