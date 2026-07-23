import { getTask, updateTask, setStepStatus, saveArtifact, getArtifacts, clearArtifacts, taskDir } from "../pipeline/repo";
import { getLLM, getBookLLM } from "../providers/llm";
import { PROMPT_B_REWRITE, PROMPT_D_BOOK } from "../prompts";
import { splitTextIntoChunks } from "../textChunks";
import { estimateSegmentDuration, splitScriptSegments, toScriptSegmentMeta } from "./scriptSegments";
import fs from "node:fs";
import path from "node:path";

const REWRITE_CHUNK_MAX_CHARS = 1800;

function readRewriteConfig(arts: ReturnType<typeof getArtifacts>) {
  for (const a of arts) {
    if (a.stepName !== "config" || a.kind !== "json" || !a.meta) continue;
    try {
      const meta = JSON.parse(a.meta);
      if (meta.key === "rewrite") return meta.value ?? null;
    } catch {
      // ignore bad config artifact
    }
  }
  return null;
}

async function rewriteChunk(
  llm: ReturnType<typeof getLLM>,
  task: any,
  chunk: string,
  index: number,
  total: number,
  rewriteNotes: string,
): Promise<string> {
  return (await llm.chat({
    system: PROMPT_B_REWRITE.system,
    user: `【长文分块 ${index + 1}/${total}】\n${PROMPT_B_REWRITE.user({
      keyword: task.keyword || "",
      title: task.title || "",
      author: task.author || "",
      rewrite_notes: rewriteNotes,
      cleaned_transcript: chunk,
    })}`,
    temperature: 0.7,
  })).trim();
}

export async function runRewrite(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  clearArtifacts(taskId, "rewrite");

  const arts = getArtifacts(taskId);
  const cleaned = arts.find((a) => a.stepName === "transcribe" && a.kind === "cleaned")?.content;
  if (!cleaned) throw new Error("缺少清洗后正文");
  const rewriteConfig = readRewriteConfig(arts);
  const rewriteNotes = typeof rewriteConfig === "string"
    ? rewriteConfig.trim()
    : typeof rewriteConfig?.notes === "string"
      ? rewriteConfig.notes.trim()
      : typeof rewriteConfig?.rewriteNotes === "string"
        ? rewriteConfig.rewriteNotes.trim()
        : "";

  // 1. 附件B 改写（temp 0.7）
  setStepStatus(taskId, "rewrite", { progress: 0.2 });
  const llm = getLLM();
  const rewriteChunks = splitTextIntoChunks(cleaned, REWRITE_CHUNK_MAX_CHARS);
  const rewrittenChunks: string[] = [];
  const failedRewriteChunks: { index: number; error: string }[] = [];
  if (rewriteChunks.length <= 1) {
    rewrittenChunks.push(await rewriteChunk(llm, task, cleaned, 0, 1, rewriteNotes));
  } else {
    for (let i = 0; i < rewriteChunks.length; i++) {
      try {
        rewrittenChunks.push(await rewriteChunk(llm, task, rewriteChunks[i], i, rewriteChunks.length, rewriteNotes));
      } catch (e: any) {
        failedRewriteChunks.push({ index: i + 1, error: String(e?.message || e).slice(0, 160) });
        rewrittenChunks.push(rewriteChunks[i].trim());
      }
      setStepStatus(taskId, "rewrite", { progress: 0.2 + 0.4 * ((i + 1) / rewriteChunks.length) });
    }
  }
  const rewritten = rewrittenChunks.map((s) => s.trim()).filter(Boolean).join("\n\n");
  const dir = taskDir(taskId);
  fs.writeFileSync(path.join(dir, "script.txt"), rewritten, "utf-8");
  saveArtifact({ taskId, stepName: "rewrite", kind: "rewrite", label: "改写后口播稿", content: rewritten });
  setStepStatus(taskId, "rewrite", { progress: 0.55 });

  // 2. 口播分段：后续 TTS、配图共用这一份，避免等 TTS 才确定图片数量。
  const segments = await splitScriptSegments(task, rewritten);
  const segmentMeta = toScriptSegmentMeta(segments).map((segment) => ({
    ...segment,
    estimatedDur: estimateSegmentDuration(segment.text),
  }));
  saveArtifact({
    taskId,
    stepName: "rewrite",
    kind: "segments",
    label: "口播分段",
    meta: {
      source: "rewrite",
      segments: segmentMeta,
      count: segmentMeta.length,
    },
  });
  setStepStatus(taskId, "rewrite", { progress: 0.65 });

  // 3. 附件D 书名识别（DeepSeek，temp 0.05，JSON）
  const bookLLM = getBookLLM();
  let bookInfo: any = { book_title: "", book_author: "", confidence: 0, evidence: "" };
  try {
    const raw = await bookLLM.chat({
      system: PROMPT_D_BOOK.system,
      user: PROMPT_D_BOOK.user({
        existing_title: task.bookTitle || "",
        existing_author: task.bookAuthor || "",
        keyword: task.keyword || "",
        source_title: task.title || "",
        source_description: "",
        script_text: cleaned.slice(0, 2600),
      }),
      temperature: 0.05,
      json: true,
    });
    bookInfo = JSON.parse(raw);
  } catch (e) {
    bookInfo.evidence = "书名识别失败: " + String((e as any)?.message || e);
  }

  // 回写任务 + 产物（confidence<0.6 需人工复核）
  updateTask(taskId, { bookTitle: bookInfo.book_title || null, bookAuthor: bookInfo.book_author || null });
  saveArtifact({
    taskId, stepName: "rewrite", kind: "json", label: "书名识别结果",
    meta: bookInfo,
  });

  setStepStatus(taskId, "rewrite", {
    output: JSON.stringify({
      rewriteLen: rewritten.length,
      rewriteNotes: rewriteNotes || null,
      rewriteChunks: rewriteChunks.length,
      segments: segmentMeta.length,
      failedRewriteChunks,
      warning: failedRewriteChunks.length ? `${failedRewriteChunks.length} 个长文分块改写失败，已用清洗稿原分块兜底` : null,
      book: bookInfo.book_title,
      author: bookInfo.book_author,
      confidence: bookInfo.confidence,
      needReview: (bookInfo.confidence ?? 0) < 0.6,
    }),
  });
}
