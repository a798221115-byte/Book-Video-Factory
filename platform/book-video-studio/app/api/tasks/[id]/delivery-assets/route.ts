import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  getArtifacts,
  getTask,
  patchArtifact,
  projectArtifactPath,
  saveArtifact,
  updateTask,
} from "@/lib/pipeline/repo";

type DeliveryAsset = {
  kind: string;
  label: string;
  path: string;
  meta?: Record<string, unknown>;
};

function upsertDeliveryAsset(taskId: string, asset: DeliveryAsset) {
  const existing = getArtifacts(taskId).find(
    (item) => item.stepName === "delivery" && item.kind === asset.kind,
  );
  if (existing) {
    patchArtifact(existing.id, {
      label: asset.label,
      path: asset.path,
      meta: JSON.stringify(asset.meta || {}),
    });
    return existing.id;
  }
  return saveArtifact({
    taskId,
    stepName: "delivery",
    kind: asset.kind,
    label: asset.label,
    path: asset.path,
    meta: asset.meta || {},
  });
}

function newestFile(directory: string, predicate: (name: string) => boolean) {
  if (!fs.existsSync(directory)) return null;
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((item) => item.isFile() && predicate(item.name))
    .map((item) => path.join(directory, item.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || null;
}

function newestDirectory(directory: string) {
  if (!fs.existsSync(directory)) return null;
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => path.join(directory, item.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || null;
}

function collectDeliveryAssets(taskId: string) {
  const task = getTask(taskId);
  if (!task?.projectPath) throw new Error("任务工作目录不存在");
  const projectDir = path.resolve(task.projectPath);
  const workRoot = path.resolve(projectDir, "jianying_draft");
  const nativeRoot = path.resolve(
    "F:\\JianyingPro\\User Data\\Projects\\com.lveditor.draft",
  );
  const coverPath = newestFile(path.join(projectDir, "cover"), (name) => /-cover\.png$/i.test(name));
  const coverValidationPath = path.join(projectDir, "cover", "validation.md");
  const draftReportPath = path.join(workRoot, "draft_check_report.json");
  const draftDirectory = newestDirectory(workRoot);
  const nativeDirectory = draftDirectory
    ? path.join(nativeRoot, path.basename(draftDirectory))
    : null;
  const validationPath = path.join(projectDir, "render", "validation-report.json");
  const reviewVideo = getArtifacts(taskId).find(
    (item) => item.stepName === "render" && item.kind === "review_video" && item.path,
  );

  const missing: string[] = [];
  if (!reviewVideo?.path) missing.push("审核成片");
  if (!coverPath || !fs.existsSync(coverPath)) missing.push("独立封面");
  if (!fs.existsSync(coverValidationPath)) missing.push("封面验收报告");
  if (!fs.existsSync(draftReportPath)) missing.push("剪映草稿验收报告");
  if (!draftDirectory || !fs.existsSync(draftDirectory)) missing.push("剪映工作副本");
  if (!nativeDirectory || !fs.existsSync(nativeDirectory)) missing.push("剪映原生草稿");
  if (!fs.existsSync(validationPath)) missing.push("成片技术验收报告");
  if (missing.length) return { missing, assets: [] as DeliveryAsset[] };

  return {
    missing,
    assets: [
      {
        kind: "review_video",
        label: "G06 60fps 审核成片",
        path: reviewVideo!.path!,
      },
      {
        kind: "cover",
        label: "G06 视频号独立封面",
        path: projectArtifactPath(coverPath!),
      },
      {
        kind: "cover_validation",
        label: "G06 封面验收报告",
        path: projectArtifactPath(coverValidationPath),
      },
      {
        kind: "jianying_draft_report",
        label: "G06 剪映草稿验收报告",
        path: projectArtifactPath(draftReportPath),
        meta: {
          workDirectory: draftDirectory,
          nativeDirectory,
        },
      },
      {
        kind: "validation_report",
        label: "G06 成片技术验收报告",
        path: projectArtifactPath(validationPath),
      },
    ] satisfies DeliveryAsset[],
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (!["waiting_render_review", "done"].includes(task.status)) {
    return NextResponse.json({ error: "成片尚未进入 G06 联合审核" }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const result = collectDeliveryAssets(id);
  if (result.missing.length) {
    return NextResponse.json({
      error: `G06 产物尚未齐全：${result.missing.join("、")}`,
      missing: result.missing,
    }, { status: 409 });
  }
  for (const asset of result.assets) upsertDeliveryAsset(id, asset);

  if (body?.action === "confirm") {
    updateTask(id, { status: "done", currentGate: "DELIVERY_COMPLETE" });
  }
  return NextResponse.json({
    ok: true,
    confirmed: body?.action === "confirm",
    assets: getArtifacts(id).filter((item) => item.stepName === "delivery"),
  });
}
