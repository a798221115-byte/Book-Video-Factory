import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  getArtifacts, getPublicationRecords, getStep, getTask, resolveArtifactPath,
  updateTask, upsertPublicationRecord, upsertWorkflowRun,
} from "@/lib/pipeline/repo";
import {
  publicationIdempotencyKey, publishSocialVideo, resolveSocialAccount, SocialPlatform,
} from "@/lib/socialUpload";
import { readTitleWorkflowMeta } from "@/lib/titleWorkflow";

const AUTHORIZATION = "AUTO_PUBLISH_CONFIRMED";
const SUPPORTED = new Set<SocialPlatform>(["douyin", "weixin_channels"]);
type PublicationTarget = { platform: SocialPlatform; accountId: string };

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
  if (![
    "ready_for_draft_upload", "done", "publication_failed", "publication_partial_failure",
  ].includes(task.status)) {
    return NextResponse.json({ error: "请先通过 C02 并完成自动交付登记" }, { status: 409 });
  }
  if (getStep(id, "media_compliance")?.status !== "done") {
    return NextResponse.json({ error: "C02 发布前完整审核尚未通过" }, { status: 409 });
  }
  const body = await req.json().catch(() => ({}));
  if (body.authorization !== AUTHORIZATION) {
    return NextResponse.json({ error: "缺少本任务的明确自动发布授权" }, { status: 400 });
  }
  const rawTargets = Array.isArray(body.targets) ? body.targets : [];
  const targets: PublicationTarget[] = rawTargets.map((target: any) => ({
    platform: String(target.platform || "") as SocialPlatform,
    accountId: String(target.accountId || "").trim(),
  })).filter((target: PublicationTarget) => SUPPORTED.has(target.platform) && target.accountId);
  const uniqueTargets = targets.filter((target, index) => targets.findIndex(
    (item) => item.platform === target.platform && item.accountId === target.accountId,
  ) === index);
  if (!uniqueTargets.length || uniqueTargets.length !== rawTargets.length) {
    return NextResponse.json({ error: "请选择至少一个有效且不重复的平台账号" }, { status: 400 });
  }
  let resolvedTargets: Array<(typeof uniqueTargets)[number] & { account: ReturnType<typeof resolveSocialAccount> }>;
  try {
    resolvedTargets = uniqueTargets.map((target) => ({
      ...target,
      account: resolveSocialAccount(target.platform, target.accountId),
    }));
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 400 });
  }

  const artifacts = getArtifacts(id);
  const videoArtifact = artifacts.find((item) => item.kind === "review_video" && item.path);
  if (!videoArtifact?.path) return NextResponse.json({ error: "缺少审核成片" }, { status: 409 });
  const videoPath = resolveArtifactPath(videoArtifact.path);
  const coverPath = newestCover(task.projectPath);
  const titles = readTitleWorkflowMeta(id);
  const longTitle = String(titles.selected_long_title || "");
  const shortTitle = String(titles.selected_short_title || "");
  if (!longTitle || !shortTitle) {
    return NextResponse.json({ error: "长标题或短标题尚未采用" }, { status: 409 });
  }

  updateTask(id, { status: "publishing", currentGate: "AUTO_PUBLICATION" });
  upsertWorkflowRun(id, "publication", {
    status: "running", progress: 0.05, message: "已获明确授权，正在自动发布", error: null,
    startedAt: Date.now(), finishedAt: null,
  });
  const results: any[] = [];
  for (const [index, target] of resolvedTargets.entries()) {
    const { account } = target;
    const key = publicationIdempotencyKey(id, target.platform, account.id, videoPath);
    const existing = getPublicationRecords(id).find(
      (item) => item.idempotencyKey === key && item.status === "published",
    );
    if (existing) {
      results.push({ ok: true, duplicatePrevented: true, record: existing });
      continue;
    }
    upsertPublicationRecord(id, key, {
      platform: target.platform, accountId: account.id, status: "publishing", error: null,
      meta: JSON.stringify({ authorization: AUTHORIZATION, authorizedAt: Date.now() }),
    });
    try {
      await publishSocialVideo({
        platform: target.platform,
        accountFile: account.file,
        videoPath,
        coverPath: coverPath || undefined,
        title: longTitle,
        shortTitle,
        description: `${longTitle}\n${(titles.hashtags || []).join(" ")}`.trim(),
        tags: titles.hashtags || [],
      });
      const publishedAt = Date.now();
      const record = upsertPublicationRecord(id, key, {
        platform: target.platform,
        accountId: account.id,
        status: "published",
        platformWorkId: `local-${key.slice(0, 12)}`,
        publishedAt,
        uploadedAt: publishedAt,
        error: null,
        meta: JSON.stringify({
          mode: "automatic_publish", authorization: AUTHORIZATION, coverPath, videoPath,
        }),
      });
      results.push({ ok: true, duplicatePrevented: false, record });
    } catch (error: any) {
      const message = String(error?.message || error);
      const record = upsertPublicationRecord(id, key, {
        platform: target.platform, accountId: account.id, status: "failed", error: message,
      });
      results.push({ ok: false, error: message, record });
    }
    upsertWorkflowRun(id, "publication", {
      status: "running",
      progress: (index + 1) / resolvedTargets.length,
      message: `已处理 ${index + 1}/${resolvedTargets.length} 个发布目标`,
    });
  }

  const failed = results.filter((result) => !result.ok);
  const finishedAt = Date.now();
  if (failed.length) {
    const partial = failed.length < results.length;
    upsertWorkflowRun(id, "publication", {
      status: "failed", progress: partial ? (results.length - failed.length) / results.length : 0,
      message: partial ? "部分平台发布失败，可安全重试失败目标" : "自动发布失败，可安全重试",
      error: failed.map((item) => `${item.record.platform}: ${item.error}`).join("\n"),
      finishedAt,
    });
    updateTask(id, {
      status: partial ? "publication_partial_failure" : "publication_failed",
      currentGate: "AUTO_PUBLICATION",
    });
    return NextResponse.json({
      ok: false,
      partial,
      error: partial ? "部分平台发布失败，可安全重试失败目标" : "自动发布失败，可安全重试",
      results,
    }, { status: 502 });
  }
  upsertWorkflowRun(id, "publication", {
    status: "succeeded", progress: 1, message: "所选平台均已自动发布成功", finishedAt,
  });
  updateTask(id, { status: "waiting_analytics_24h", currentGate: "ANALYTICS_24H" });
  return NextResponse.json({ ok: true, results });
}
