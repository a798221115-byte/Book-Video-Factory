import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import {
  getMetricSnapshots, getPublicationRecords, getTask, updateTask,
  upsertMetricSnapshot, upsertWorkflowRun,
} from "@/lib/pipeline/repo";

const HORIZONS = ["24h", "72h", "7d"] as const;

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function derive(metrics: Record<string, number>) {
  const plays = Math.max(1, metrics.plays);
  return {
    interactionRate: (metrics.likes + metrics.comments + metrics.shares + metrics.favorites) / plays,
    shareRate: metrics.shares / plays,
    favoriteRate: metrics.favorites / plays,
    followConversionRate: metrics.newFollowers / Math.max(1, metrics.uniqueViewers || metrics.plays),
    productClickRate: metrics.productClicks / plays,
    orderConversionRate: metrics.orders / Math.max(1, metrics.productClicks),
  };
}

function review(metrics: Record<string, number>, derived: ReturnType<typeof derive>) {
  const findings: string[] = [];
  if (metrics.completionRate < 0.25) findings.push("完播率偏低，优先复盘开头三秒和叙事节奏");
  if (derived.shareRate < 0.005) findings.push("分享率偏低，下一条强化可转述观点和受众身份感");
  if (derived.favoriteRate > derived.shareRate * 1.5) findings.push("收藏强于分享，内容更像工具资料，可测试清单式标题");
  if (metrics.productClicks > 0 && metrics.orders === 0) findings.push("已有商品点击但没有订单，检查商品承接、版本和价格");
  if (!findings.length) findings.push("当前指标结构正常，下一条优先复用本条钩子与情绪推进方式");
  return findings.join("；");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const publication = getPublicationRecords(id).find((item) => item.status === "published");
  if (!publication) return NextResponse.json({ error: "请先完成 G08 人工发布确认" }, { status: 409 });
  const body = await req.json().catch(() => ({}));
  const horizon = String(body.horizon || "");
  if (!HORIZONS.includes(horizon as any)) {
    return NextResponse.json({ error: "horizon 只能是 24h、72h 或 7d" }, { status: 400 });
  }
  const source = body.metrics || {};
  const metrics = {
    plays: number(source.plays),
    uniqueViewers: number(source.uniqueViewers),
    averageWatchSeconds: number(source.averageWatchSeconds),
    completionRate: number(source.completionRate),
    likes: number(source.likes),
    comments: number(source.comments),
    shares: number(source.shares),
    favorites: number(source.favorites),
    newFollowers: number(source.newFollowers),
    productClicks: number(source.productClicks),
    orders: number(source.orders),
    gmv: number(source.gmv),
    commission: number(source.commission),
  };
  const derived = derive(metrics);
  const conclusion = review(metrics, derived);
  const snapshot = upsertMetricSnapshot({
    id: nanoid(12),
    taskId: id,
    publicationId: publication.id,
    horizon,
    capturedAt: Number(body.capturedAt || Date.now()),
    metrics: JSON.stringify(metrics),
    derived: JSON.stringify(derived),
    review: conclusion,
    createdAt: Date.now(),
  });
  const snapshots = getMetricSnapshots(id);
  const complete = HORIZONS.every((item) => snapshots.some((snapshot) => snapshot.horizon === item));
  const nextMissing = HORIZONS.find((item) => !snapshots.some((snapshot) => snapshot.horizon === item));
  upsertWorkflowRun(id, "analytics", {
    status: complete ? "succeeded" : "waiting",
    progress: snapshots.length / HORIZONS.length,
    message: complete ? "24h、72h、7d 数据复盘已完成" : `已保存 ${horizon} 数据，等待下一次快照`,
    ...(complete ? { finishedAt: Date.now() } : {}),
  });
  updateTask(id, complete
    ? { status: "analytics_complete", currentGate: "ANALYTICS_COMPLETE" }
    : { status: `waiting_analytics_${nextMissing || "7d"}`, currentGate: "ANALYTICS" });
  return NextResponse.json({ ok: true, snapshot, complete });
}
