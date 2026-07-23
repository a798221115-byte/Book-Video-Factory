import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  findRelevantBookPassages,
  parseEpubBuffer,
  writeParsedBookSourceAudit,
} from "@/lib/bookSource";
import {
  getArtifacts,
  getTask,
  patchArtifact,
  projectArtifactPath,
  saveArtifact,
  taskDir,
} from "@/lib/pipeline/repo";

export const runtime = "nodejs";

function safeFileName(fileName: string) {
  const base = path.basename(fileName, path.extname(fileName))
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "uploaded-book";
  return `${base}.epub`;
}

function upsertArtifact(input: {
  taskId: string;
  stepName: string;
  kind: string;
  label: string;
  content?: string;
  meta?: unknown;
  path?: string;
}) {
  const existing = getArtifacts(input.taskId).find(
    (item) => item.stepName === input.stepName && item.kind === input.kind,
  );
  const patch = {
    label: input.label,
    content: input.content ?? null,
    meta: input.meta ? JSON.stringify(input.meta) : null,
    path: input.path ?? null,
  };
  if (existing) {
    patchArtifact(existing.id, patch);
    return existing.id;
  }
  return saveArtifact(input);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (!["ready_for_weread", "highlights_confirmed", "waiting_script_confirmation"].includes(task.status)) {
    return NextResponse.json({ error: "当前阶段不能更换图书来源" }, { status: 409 });
  }
  if (!task.bookTitle || !task.bookAuthor) {
    return NextResponse.json({ error: "请先确认准确书名和作者" }, { status: 409 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择 EPUB 原书文件" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".epub")) {
      return NextResponse.json({ error: "当前仅支持 EPUB 文件" }, { status: 415 });
    }
    if (file.size <= 0 || file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "EPUB 文件必须大于 0 且不超过 50MB" }, { status: 413 });
    }

    const artifacts = getArtifacts(id);
    const cleaned = artifacts.find(
      (item) => item.stepName === "transcribe" && item.kind === "cleaned",
    )?.content || "";
    const viralStructure = artifacts.find(
      (item) => item.stepName === "analyze" && item.kind === "viral_structure",
    )?.content || "";
    if (!cleaned) {
      return NextResponse.json({ error: "缺少参考视频清洗稿，无法做相关性匹配" }, { status: 409 });
    }

    const sourceDirectory = path.join(taskDir(id), "source_book");
    fs.mkdirSync(sourceDirectory, { recursive: true });
    const storedName = safeFileName(file.name);
    const sourcePath = path.join(sourceDirectory, storedName);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(sourcePath, buffer);
    const parsed = parseEpubBuffer(buffer);
    upsertArtifact({
      taskId: id,
      stepName: "weread",
      kind: "book_source_file",
      label: "用户上传的 EPUB 原书",
      path: projectArtifactPath(sourcePath),
      meta: {
        sourceType: "uploaded_epub",
        originalFileName: file.name,
        storedFileName: storedName,
        bytes: file.size,
        epubTitle: parsed.title,
        epubAuthor: parsed.author,
        paragraphCount: parsed.paragraphs.length,
        uploadedAt: Date.now(),
      },
    });

    const result = await findRelevantBookPassages({
      parsed,
      sourceFile: storedName,
      bookTitle: task.bookTitle,
      bookAuthor: task.bookAuthor,
      cleanedTranscript: cleaned,
      viralStructure,
      limit: 20,
    });
    const audit = writeParsedBookSourceAudit(sourceDirectory, parsed, result);
    upsertArtifact({
      taskId: id,
      stepName: "weread",
      kind: "book_source_analysis",
      label: "DeepSeek 原书相关性分析",
      content: JSON.stringify(result.themes, null, 2),
      path: projectArtifactPath(audit.matchesPath),
      meta: {
        sourceType: "uploaded_epub",
        model: "deepseek",
        paragraphCount: result.paragraphCount,
        candidateCount: result.candidates.length,
        paragraphsPath: projectArtifactPath(audit.paragraphsPath),
        analyzedAt: Date.now(),
      },
    });
    const existingCandidates = getArtifacts(id).find(
      (item) => item.stepName === "weread" && item.kind === "top_highlight_candidates",
    );
    const candidateMeta = {
      sourceType: "uploaded_epub",
      sourceLabel: "用户上传 EPUB 原书",
      book: {
        title: result.epubTitle || task.bookTitle,
        author: result.epubAuthor || task.bookAuthor,
        fileName: storedName,
      },
      highlights: result.candidates,
      hasMore: false,
      loadedCount: result.candidates.length,
      paragraphCount: result.paragraphCount,
      analyzedAt: Date.now(),
    };
    const candidateContent = result.candidates
      .map((item: any, index: number) => `${index + 1}. 相关度 ${item.relevanceScore}｜${item.chapter}｜${item.text}`)
      .join("\n");
    if (existingCandidates) {
      patchArtifact(existingCandidates.id, {
        label: `原书相关候选段落（${result.candidates.length} 条）`,
        content: candidateContent,
        meta: JSON.stringify(candidateMeta),
      });
    } else {
      saveArtifact({
        taskId: id,
        stepName: "weread",
        kind: "top_highlight_candidates",
        label: `原书相关候选段落（${result.candidates.length} 条）`,
        content: candidateContent,
        meta: candidateMeta,
      });
    }
    upsertArtifact({
      taskId: id,
      stepName: "weread",
      kind: "book_source_status",
      label: "原书文件分析状态",
      content: "已完成 EPUB 解析与 DeepSeek 相关性筛选",
      meta: {
        status: "ready",
        sourceType: "uploaded_epub",
        candidateCount: result.candidates.length,
        updatedAt: Date.now(),
      },
    });
    return NextResponse.json({
      ok: true,
      sourceType: "uploaded_epub",
      book: candidateMeta.book,
      paragraphCount: result.paragraphCount,
      highlights: result.candidates,
      loadedCount: result.candidates.length,
    });
  } catch (error: any) {
    upsertArtifact({
      taskId: id,
      stepName: "weread",
      kind: "book_source_status",
      label: "原书文件分析状态",
      content: String(error?.message || error),
      meta: {
        status: "failed",
        sourceType: "uploaded_epub",
        error: String(error?.message || error),
        updatedAt: Date.now(),
      },
    });
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
