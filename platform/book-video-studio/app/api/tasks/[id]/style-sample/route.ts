import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getArtifacts,
  getTask,
  patchArtifact,
  projectArtifactPath,
  saveArtifact,
  taskDir,
  updateTask,
} from "@/lib/pipeline/repo";
import { startRemainingImageQueue } from "@/lib/storyboardGeneration";

function fileSha256(filePath: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action === "register") {
    if (!["ready_for_style_sample", "waiting_style_confirmation"].includes(task.status)) {
      return NextResponse.json({ error: "当前阶段不能登记风格样图" }, { status: 409 });
    }
    const allowedRoot = path.resolve(taskDir(id), "storyboard", "images");
    const imageFileName = path.basename(String(body.imageFileName || ""));
    const imagePath = path.resolve(allowedRoot, imageFileName);
    if (!imagePath.startsWith(allowedRoot + path.sep) || !fs.existsSync(imagePath)) {
      return NextResponse.json({ error: "样图必须存在于当前任务 storyboard/images 目录" }, { status: 400 });
    }
    const promptFileName = path.basename(String(body.promptFileName || ""));
    const promptPath = path.resolve(taskDir(id), "storyboard", "prompts", promptFileName);
    const prompt = promptPath.startsWith(path.resolve(taskDir(id)) + path.sep) && fs.existsSync(promptPath)
      ? fs.readFileSync(promptPath, "utf8")
      : String(body.prompt || "");
    const storedPath = projectArtifactPath(imagePath);
    const existing = getArtifacts(id).find(
      (item) => item.stepName === "storyboard" && item.kind === "style_sample",
    );
    const meta = {
      generatedBy: "codex-built-in-imagegen",
      prompt,
      promptPath: promptPath && fs.existsSync(promptPath) ? projectArtifactPath(promptPath) : null,
      sha256: fileSha256(imagePath),
      approvalRequired: true,
      registeredAt: Date.now(),
    };
    if (existing) {
      patchArtifact(existing.id, {
        label: "G03 Codex 风格样图",
        path: storedPath,
        meta: JSON.stringify(meta),
      });
    } else {
      saveArtifact({
        taskId: id,
        stepName: "storyboard",
        kind: "style_sample",
        label: "G03 Codex 风格样图",
        path: storedPath,
        meta,
      });
    }
    updateTask(id, {
      status: "waiting_style_confirmation",
      currentGate: "STYLE_SAMPLE_CONFIRMATION",
    });
    return NextResponse.json({ ok: true, path: storedPath, sha256: meta.sha256 });
  }

  if (action === "confirm") {
    if (task.status !== "waiting_style_confirmation") {
      return NextResponse.json({ error: "当前没有待确认的风格样图" }, { status: 409 });
    }
    const sample = getArtifacts(id).find(
      (item) => item.stepName === "storyboard" && item.kind === "style_sample",
    );
    if (!sample) return NextResponse.json({ error: "缺少风格样图产物" }, { status: 409 });
    const previousMeta = (() => {
      try { return sample.meta ? JSON.parse(sample.meta) : {}; }
      catch { return {}; }
    })();
    patchArtifact(sample.id, {
      meta: JSON.stringify({ ...previousMeta, approvedAt: Date.now() }),
    });
    const manifest = startRemainingImageQueue(id);
    return NextResponse.json({
      ok: true,
      nextGate: "REMAINING_IMAGES_GENERATING",
      queued: manifest.jobs.length,
    });
  }

  return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
}
