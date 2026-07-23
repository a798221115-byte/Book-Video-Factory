import { NextResponse } from "next/server";
import { fetchTopPopularHighlights } from "@/lib/providers/weread";
import { getArtifacts, getTask, patchArtifact, saveArtifact } from "@/lib/pipeline/repo";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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
    const result = await fetchTopPopularHighlights(task.bookTitle, task.bookAuthor);
    const existing = getArtifacts(id).find(
      (item) => item.stepName === "weread" && item.kind === "top_highlight_candidates",
    );
    const content = result.highlights
      .map((item: any, index: number) => `${index + 1}. ${item.count} 人｜${item.chapter || "章节未返回"}｜${item.text}`)
      .join("\n");
    const meta = JSON.stringify({ ...result, fetchedAt: Date.now() });
    if (existing) {
      patchArtifact(existing.id, {
        label: "微信读书前 10 热门划线",
        content,
        meta,
      });
    } else {
      saveArtifact({
        taskId: id,
        stepName: "weread",
        kind: "top_highlight_candidates",
        label: "微信读书前 10 热门划线",
        content,
        meta: { ...result, fetchedAt: Date.now() },
      });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 502 });
  }
}
