import { NextResponse } from "next/server";
import { discoverWeReadTopics } from "@/lib/providers/weread";
import {
  createTask, renameTaskWorkDirForBook, saveArtifact, updateTask, upsertWorkflowRun,
} from "@/lib/pipeline/repo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const keyword = new URL(req.url).searchParams.get("keyword") || "";
  try {
    const candidates = await discoverWeReadTopics(keyword);
    return NextResponse.json({ ok: true, candidates, generatedAt: Date.now() });
  } catch (error: any) {
    return NextResponse.json({
      error: String(error?.message || error),
      blocker: "微信读书不可用时不会使用模拟候选替代",
    }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const book = body?.book || {};
  if (!book.bookId || !String(book.title || "").trim()) {
    return NextResponse.json({ error: "缺少微信读书 bookId 或书名" }, { status: 400 });
  }
  const sourceUrl = String(book.deepLink || `weread:${book.bookId}`);
  const taskId = createTask(sourceUrl, "weread-active-topic");
  updateTask(taskId, {
    title: String(book.title),
    author: String(book.author || ""),
    bookTitle: String(book.title),
    bookAuthor: String(book.author || ""),
    status: "ready_for_weread",
    currentGate: "WEREAD_HIGHLIGHTS",
  });
  renameTaskWorkDirForBook(taskId, String(book.title));
  saveArtifact({
    taskId,
    stepName: "topic_discovery",
    kind: "topic_candidate",
    label: "G00 已确认微信读书主动选题",
    meta: { ...book, confirmedAt: Date.now(), source: "weread_active_topic" },
  });
  upsertWorkflowRun(taskId, "topic_discovery", {
    status: "succeeded",
    progress: 1,
    message: `已确认主动选题《${String(book.title)}》`,
    finishedAt: Date.now(),
  });
  return NextResponse.json({ ok: true, taskId });
}
