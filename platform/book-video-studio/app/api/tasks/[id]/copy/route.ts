import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { generateDbsCopy, type VerifiedHighlight } from "@/lib/dbsCopy";
import {
  getArtifacts,
  getTask,
  patchArtifact,
  saveArtifact,
  taskDir,
  updateTask,
} from "@/lib/pipeline/repo";

function parseJson(raw: string | null | undefined) {
  try { return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}

function parseHighlights(text: string): VerifiedHighlight[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s*(?:\||｜|\t)\s*/).filter(Boolean);
      const firstIsCount = /^\d[\d,]*$/.test(parts[0] || "");
      return {
        count: firstIsCount ? Number(parts[0].replaceAll(",", "")) : null,
        chapter: firstIsCount && parts.length >= 3 ? parts[1] : "",
        text: firstIsCount && parts.length >= 3 ? parts.slice(2).join("｜") : line,
      };
    })
    .filter((item) => item.text);
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

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action === "save_direction") {
    if (!["ready_for_weread", "highlights_confirmed", "waiting_script_confirmation"].includes(task.status)) {
      return NextResponse.json({ error: "当前阶段不能修改二创方向" }, { status: 409 });
    }
    const direction = String(body.direction || "").trim().slice(0, 1000);
    upsertArtifact({
      taskId: id,
      stepName: "rewrite",
      kind: "copy_direction",
      label: "DBS 二创微调方向",
      content: direction,
      meta: { updatedAt: Date.now(), maxLength: 1000 },
    });
    return NextResponse.json({ ok: true, direction });
  }

  if (action === "confirm_highlights") {
    if (!["ready_for_weread", "highlights_confirmed", "waiting_script_confirmation"].includes(task.status)) {
      return NextResponse.json({ error: "请先确认准确书名和作者" }, { status: 409 });
    }
    const structuredHighlights = Array.isArray(body.highlights)
      ? body.highlights
        .slice(0, 30)
        .map((item: any) => ({
          text: String(item.text || "").trim().slice(0, 2000),
          chapter: String(item.chapter || "").trim().slice(0, 300),
          count: item.count == null || item.count === ""
            ? null
            : Number.isFinite(Number(item.count)) ? Number(item.count) : null,
          sourceType: String(item.sourceType || body.sourceType || "weread"),
          sourceLabel: String(item.sourceLabel || ""),
          sourceFile: String(item.sourceFile || ""),
          location: String(item.location || ""),
          relevanceReason: String(item.relevanceReason || ""),
        }))
        .filter((item: VerifiedHighlight) => item.text)
      : [];
    const legacyContent = String(body.highlightsText || "").trim();
    const highlights = structuredHighlights.length
      ? structuredHighlights
      : parseHighlights(legacyContent);
    if (!highlights.length) {
      return NextResponse.json({ error: "请至少选择一条可追溯的原文证据" }, { status: 400 });
    }
    const sourceType = String(body.sourceType || highlights[0]?.sourceType || "weread");
    const content = structuredHighlights.length
      ? highlights.map((item: VerifiedHighlight) => (
        `${item.count == null ? "原书" : item.count}｜${item.chapter || "章节未返回"}｜${item.text}`
      )).join("\n")
      : legacyContent;
    upsertArtifact({
      taskId: id,
      stepName: "weread",
      kind: "popular_highlights",
      label: sourceType === "uploaded_book" || sourceType === "uploaded_epub"
        ? "已确认的原书相关段落"
        : "已确认的微信读书热门划线",
      content,
      meta: { highlights, sourceType, confirmedAt: Date.now() },
    });
    updateTask(id, { status: "highlights_confirmed", currentGate: "COPY_GENERATION" });
    return NextResponse.json({ ok: true, count: highlights.length });
  }

  if (action === "confirm_script") {
    if (task.status !== "waiting_script_confirmation") {
      return NextResponse.json({ error: "当前没有待确认的候选文案" }, { status: 409 });
    }
    const script = String(body.script || "").trim();
    if (!script) return NextResponse.json({ error: "候选文案不能为空" }, { status: 400 });
    const outputPath = path.join(taskDir(id), "script.txt");
    fs.writeFileSync(outputPath, script + "\n", "utf8");
    upsertArtifact({
      taskId: id,
      stepName: "rewrite",
      kind: "confirmed_script",
      label: "用户已确认口播稿",
      content: script,
      path: outputPath,
      meta: { confirmedAt: Date.now(), nextGate: "STYLE_SAMPLE" },
    });
    updateTask(id, { status: "ready_for_style_sample", currentGate: "STYLE_SAMPLE" });
    return NextResponse.json({ ok: true, path: outputPath });
  }

  return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (!["highlights_confirmed", "waiting_script_confirmation"].includes(task.status)) {
    return NextResponse.json({ error: "请先展示并明确确认可追溯的原文证据" }, { status: 409 });
  }
  if (!task.bookTitle || !task.bookAuthor) {
    return NextResponse.json({ error: "缺少已确认的书名或作者" }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const requestedDirection = String(body.direction || "").trim().slice(0, 1000);
  const artifacts = getArtifacts(id);
  const savedDirection = artifacts.find(
    (item) => item.stepName === "rewrite" && item.kind === "copy_direction",
  )?.content || "";
  const copyDirection = requestedDirection || savedDirection;
  upsertArtifact({
    taskId: id,
    stepName: "rewrite",
    kind: "copy_direction",
    label: "DBS 二创微调方向",
    content: requestedDirection,
    meta: { updatedAt: Date.now(), maxLength: 1000 },
  });
  const highlightArtifact = artifacts.find(
    (item) => item.stepName === "weread" && item.kind === "popular_highlights",
  );
  const highlights = parseJson(highlightArtifact?.meta).highlights as VerifiedHighlight[] | undefined;
  if (!Array.isArray(highlights) || !highlights.length) {
    return NextResponse.json({ error: "缺少已确认的原文证据" }, { status: 409 });
  }
  const cleaned = artifacts.find(
    (item) => item.stepName === "transcribe" && item.kind === "cleaned",
  )?.content || "";
  const viralStructure = artifacts.find(
    (item) => item.stepName === "analyze" && item.kind === "viral_structure",
  )?.content || "";
  if (!cleaned) return NextResponse.json({ error: "缺少参考视频清洗稿" }, { status: 409 });

  try {
    const result = await generateDbsCopy({
      bookTitle: task.bookTitle,
      bookAuthor: task.bookAuthor,
      sourceTitle: task.title || "",
      cleanedTranscript: cleaned,
      viralStructure,
      highlights,
      extraNotes: copyDirection,
    });
    const dir = taskDir(id);
    const candidatePath = path.join(dir, "script-candidate.txt");
    fs.writeFileSync(candidatePath, String(result.draft.script).trim() + "\n", "utf8");
    upsertArtifact({
      taskId: id,
      stepName: "rewrite",
      kind: "dbs_analysis",
      label: "DBS 爆款结构与传播心理诊断",
      content: JSON.stringify(result.analysis, null, 2),
      meta: { methodVersion: "dbskill-v2.18.4", model: "deepseek" },
    });
    upsertArtifact({
      taskId: id,
      stepName: "rewrite",
      kind: "copy_candidate",
      label: "DeepSeek × DBS 二创候选稿",
      content: String(result.draft.script).trim(),
      path: candidatePath,
      meta: {
        hooks: result.draft.hook_candidates || [],
        topHooks: result.draft.top_hooks || [],
        selectedHook: result.draft.selected_hook || "",
        quoteUsage: result.draft.quote_usage || [],
        originalReflections: result.draft.original_reflections || [],
        boundaryNote: result.draft.copy_boundary_note || "",
        copyDirection: copyDirection || null,
      },
    });
    upsertArtifact({
      taskId: id,
      stepName: "rewrite",
      kind: "dbs_flow_audit",
      label: "DBS 完播风险审校",
      content: JSON.stringify(result.audit, null, 2),
      meta: { requiresRevision: Boolean(result.audit?.requires_revision) },
    });
    updateTask(id, { status: "waiting_script_confirmation", currentGate: "SCRIPT_CONFIRMATION" });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
