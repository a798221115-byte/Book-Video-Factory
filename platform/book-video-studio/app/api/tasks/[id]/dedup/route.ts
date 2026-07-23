import { NextRequest, NextResponse } from "next/server";
import { getArtifacts, getTask, clearArtifacts, saveArtifact } from "@/lib/pipeline/repo";
import { getBookLLM } from "@/lib/providers/llm";
import { PROMPT_C_DEDUP } from "@/lib/prompts";

// 附件C 轻量去重微调：旁路工具，不进主流水线。
// 输入已清洗正文，从书名识别 JSON 自动提取 protected_terms（书名/作者），
// 用 DeepSeek（getBookLLM，中文语义把握更稳）做克制微调，产出字数漂移 ≤8% 的变体。
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const arts = getArtifacts(id);
  const cleaned = arts.find((a) => a.stepName === "transcribe" && a.kind === "cleaned")?.content;
  if (!cleaned) {
    return NextResponse.json({ error: "缺少已清洗正文，请先完成逐字稿清洗" }, { status: 400 });
  }
  const transcript =
    arts.find((a) => a.stepName === "transcribe" && a.kind === "transcript")?.content || cleaned;

  // 从书名识别 JSON 自动提取必须原样保留的词（书名、作者）
  const bookMeta = (() => {
    const raw = arts.find((a) => a.stepName === "rewrite" && a.kind === "json")?.meta;
    if (!raw) return {} as any;
    try { return JSON.parse(raw); } catch { return {} as any; }
  })();
  const protectedTerms = [bookMeta.book_title, bookMeta.book_author]
    .map((s: unknown) => String(s || "").trim())
    .filter(Boolean)
    .join("、");

  let deduped: string;
  try {
    deduped = await getBookLLM().chat({
      system: PROMPT_C_DEDUP.system,
      user: PROMPT_C_DEDUP.user({
        keyword: task.keyword || "",
        title: task.title || "",
        author: task.author || "",
        protected_terms: protectedTerms,
        transcript,
        cleaned_transcript: cleaned,
      }),
      temperature: 0.8,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "去重微调失败: " + String(e?.message || e) }, { status: 502 });
  }

  deduped = deduped.trim();
  const baseLen = cleaned.replace(/\s/g, "").length;
  const newLen = deduped.replace(/\s/g, "").length;
  const diffPct = baseLen ? Math.round((Math.abs(newLen - baseLen) / baseLen) * 1000) / 10 : 0;

  // 旁路产物：覆盖式保存（每次只留最新一版去重稿）
  clearArtifacts(id, "dedup");
  saveArtifact({
    taskId: id,
    stepName: "dedup",
    kind: "text",
    label: "去重微调稿",
    content: deduped,
    meta: {
      protected_terms: protectedTerms,
      base_len: baseLen,
      dedup_len: newLen,
      diff_pct: diffPct,
      created_at: Date.now(),
    },
  });

  return NextResponse.json({
    ok: true,
    content: deduped,
    protectedTerms,
    baseLen,
    dedupLen: newLen,
    diffPct,
  });
}
