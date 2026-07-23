import { NextResponse } from "next/server";
import { fetchTopPopularHighlights } from "@/lib/providers/weread";
import { getArtifacts, getTask, patchArtifact, saveArtifact } from "@/lib/pipeline/repo";

function parseMeta(value: unknown) {
  if (value && typeof value === "object") return value as Record<string, any>;
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (!["ready_for_weread", "highlights_confirmed", "waiting_script_confirmation"].includes(task.status)) {
    return NextResponse.json({ error: "请先确认准确书名和作者" }, { status: 409 });
  }
  if (!task.bookTitle || !task.bookAuthor) {
    return NextResponse.json({ error: "缺少已确认的书名或作者" }, { status: 409 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const existing = getArtifacts(id).find(
      (item) => item.stepName === "weread" && item.kind === "top_highlight_candidates",
    );
    const existingMeta = parseMeta(existing?.meta);
    const previousHighlights = body.reset === false && Array.isArray(existingMeta.highlights)
      ? existingMeta.highlights
      : [];
    const offset = body.reset === false
      ? Math.max(0, Math.floor(Number(body.offset ?? previousHighlights.length) || 0))
      : 0;
    const result = await fetchTopPopularHighlights(task.bookTitle, task.bookAuthor, {
      offset,
      limit: 10,
    });
    const merged = new Map<string, any>();
    for (const item of [...previousHighlights, ...result.highlights]) {
      merged.set(String(item.id), item);
    }
    const highlights = Array.from(merged.values())
      .sort((a: any, b: any) => Number(b.count || 0) - Number(a.count || 0) || String(a.id).localeCompare(String(b.id)))
      .map((item: any, index: number) => ({ ...item, rank: index + 1 }));
    const responsePayload = {
      ...result,
      batch: result.highlights,
      highlights,
      loadedCount: highlights.length,
      nextOffset: highlights.length,
    };
    const content = highlights
      .map((item: any, index: number) => `${index + 1}. ${item.count} 人｜${item.chapter || "章节未返回"}｜${item.text}`)
      .join("\n");
    const meta = JSON.stringify({ ...responsePayload, fetchedAt: Date.now() });
    if (existing) {
      patchArtifact(existing.id, {
        label: `微信读书热门划线（已加载 ${highlights.length} 条）`,
        content,
        meta,
      });
    } else {
      saveArtifact({
        taskId: id,
        stepName: "weread",
        kind: "top_highlight_candidates",
        label: `微信读书热门划线（已加载 ${highlights.length} 条）`,
        content,
        meta: { ...responsePayload, fetchedAt: Date.now() },
      });
    }
    return NextResponse.json(responsePayload);
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 502 });
  }
}
