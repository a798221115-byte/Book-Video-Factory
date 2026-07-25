import { NextResponse } from "next/server";
import {
  getPublicationRecords, getTask, updateTask, upsertPublicationRecord, upsertWorkflowRun,
} from "@/lib/pipeline/repo";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const record = getPublicationRecords(id).find((item) => item.status === "draft_ready")
    || getPublicationRecords(id).find((item) => item.status === "published");
  if (!record) return NextResponse.json({ error: "没有可确认的视频号草稿记录" }, { status: 409 });
  const platformWorkId = String(body.platformWorkId || "").trim();
  const publishedAt = Number(body.publishedAt || Date.now());
  if (!platformWorkId) return NextResponse.json({ error: "请填写视频号作品 ID" }, { status: 400 });
  const updated = upsertPublicationRecord(id, record.idempotencyKey, {
    status: "published",
    platformWorkId,
    url: String(body.url || "").trim() || null,
    accountId: String(body.accountId || record.accountId || ""),
    publishedAt,
    error: null,
  });
  upsertWorkflowRun(id, "publication", {
    status: "succeeded", progress: 1, message: "人工发布结果已确认",
    startedAt: publishedAt, finishedAt: Date.now(),
  });
  updateTask(id, { status: "waiting_analytics_24h", currentGate: "ANALYTICS_24H" });
  return NextResponse.json({ ok: true, record: updated });
}
