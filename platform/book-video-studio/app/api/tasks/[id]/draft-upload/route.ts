import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  getArtifacts, getPublicationRecords, getStep, getTask, resolveArtifactPath,
  updateTask, upsertPublicationRecord, upsertWorkflowRun,
} from "@/lib/pipeline/repo";
import {
  draftIdempotencyKey, resolveWeixinAccount, uploadWeixinDraft,
} from "@/lib/socialUpload";
import { readTitleWorkflowMeta } from "@/lib/titleWorkflow";

function newestCover(projectPath: string) {
  const dir = path.join(projectPath, "cover");
  if (!fs.existsSync(dir)) return "";
  return fs.readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .map((name) => path.join(dir, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || "";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task?.projectPath) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (!["ready_for_draft_upload", "draft_upload_failed", "done"].includes(task.status)) {
    return NextResponse.json({ error: "请先通过 C02 完整审核并确认 G06 成片" }, { status: 409 });
  }
  if (getStep(id, "media_compliance")?.status !== "done") {
    return NextResponse.json({ error: "C02 发布前完整审核尚未通过" }, { status: 409 });
  }
  const body = await req.json().catch(() => ({}));
  const account = resolveWeixinAccount(String(body.accountId || ""));
  const artifacts = getArtifacts(id);
  const videoArtifact = artifacts.find((item) => item.kind === "review_video" && item.path);
  if (!videoArtifact?.path) return NextResponse.json({ error: "缺少审核成片" }, { status: 409 });
  const videoPath = resolveArtifactPath(videoArtifact.path);
  const coverPath = newestCover(task.projectPath);
  const titles = readTitleWorkflowMeta(id);
  const longTitle = String(titles.selected_long_title || "");
  const shortTitle = String(titles.selected_short_title || "");
  if (!longTitle || !shortTitle) return NextResponse.json({ error: "长标题或短标题未确认" }, { status: 409 });
  const key = draftIdempotencyKey(id, account.id, videoPath);
  const existing = getPublicationRecords(id).find(
    (item) => item.idempotencyKey === key && item.status === "draft_ready",
  );
  if (existing) return NextResponse.json({ ok: true, duplicatePrevented: true, record: existing });

  upsertPublicationRecord(id, key, { accountId: account.id, status: "uploading", error: null });
  upsertWorkflowRun(id, "draft_upload", {
    status: "queued", progress: 0, message: "视频号草稿上传已排队", error: null,
    startedAt: null, finishedAt: null,
  });
  upsertWorkflowRun(id, "draft_upload", {
    status: "running", progress: 0.1, message: "正在上传视频号草稿", startedAt: Date.now(),
  });
  updateTask(id, { status: "uploading_draft", currentGate: "DRAFT_UPLOAD" });
  try {
    await uploadWeixinDraft({
      accountFile: account.file,
      videoPath,
      coverPath: coverPath || undefined,
      title: longTitle,
      shortTitle,
      description: `${longTitle}\n${(titles.hashtags || []).join(" ")}`.trim(),
      tags: titles.hashtags || [],
    });
    const uploadedAt = Date.now();
    const record = upsertPublicationRecord(id, key, {
      accountId: account.id,
      status: "draft_ready",
      draftId: `local-${key.slice(0, 12)}`,
      uploadedAt,
      error: null,
      meta: JSON.stringify({ mode: "draft_only", coverPath, videoPath }),
    });
    upsertWorkflowRun(id, "draft_upload", {
      status: "succeeded", progress: 1, message: "视频号草稿保存成功",
      finishedAt: uploadedAt,
    });
    updateTask(id, { status: "waiting_publication_confirmation", currentGate: "PUBLICATION_CONFIRMATION" });
    return NextResponse.json({ ok: true, record });
  } catch (error: any) {
    const message = String(error?.message || error);
    upsertPublicationRecord(id, key, { accountId: account.id, status: "failed", error: message });
    upsertWorkflowRun(id, "draft_upload", {
      status: "failed", progress: 0, message: "草稿上传失败，可安全重试", error: message,
      finishedAt: Date.now(),
    });
    updateTask(id, { status: "draft_upload_failed", currentGate: "DRAFT_UPLOAD" });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
