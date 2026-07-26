import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  getTask,
  getArtifacts,
  patchArtifact,
  projectArtifactPath,
  renameTaskWorkDirForBook,
  saveArtifact,
  taskDir,
  updateTask,
} from "@/lib/pipeline/repo";

function parseArtifactMeta(raw: string | null) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function invalidateBookDependentArtifacts(taskId: string) {
  const invalidatedAt = Date.now();
  for (const artifact of getArtifacts(taskId)) {
    if (artifact.stepName !== "weread") continue;
    const meta = parseArtifactMeta(artifact.meta);
    if (meta.invalidatedAt) continue;
    patchArtifact(artifact.id, {
      meta: JSON.stringify({
        ...meta,
        invalidatedAt,
        invalidationReason: "book_confirmation_changed",
      }),
    });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const bookTitle = String(body.bookTitle || "").trim();
  const bookAuthor = String(body.bookAuthor || "").trim();
  const preserveStage = body.preserveStage === true;
  if (!bookTitle || !bookAuthor) {
    return NextResponse.json({ error: "书名和作者都必须确认" }, { status: 400 });
  }

  const projectPath = renameTaskWorkDirForBook(id, bookTitle);
  invalidateBookDependentArtifacts(id);
  updateTask(id, {
    bookTitle,
    bookAuthor,
    status: preserveStage ? task.status : "ready_for_weread",
    currentGate: preserveStage ? task.currentGate : "WEREAD_HIGHLIGHTS",
  });

  const meta = {
    book_title: bookTitle,
    book_author: bookAuthor,
    confirmed_at: Date.now(),
    evidence: "人工确认保存",
    next_gate: preserveStage ? task.currentGate : "微信读书版本与热门划线",
    project_path: projectPath,
  };
  const clipsDir = path.join(taskDir(id), "video_clips");
  fs.mkdirSync(clipsDir, { recursive: true });
  const confirmationPath = path.join(clipsDir, "book-confirmation.json");
  fs.writeFileSync(confirmationPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
  saveArtifact({
    taskId: id,
    stepName: "analyze",
    kind: "book_confirmation",
    label: "人工确认的图书信息",
    path: projectArtifactPath(confirmationPath),
    meta,
  });

  return NextResponse.json({ ok: true, book: meta });
}
