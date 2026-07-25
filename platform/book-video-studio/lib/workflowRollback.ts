import fs from "node:fs";
import path from "node:path";
import type { StepName } from "./pipeline/steps";
import {
  getArtifacts,
  getPublicationRecords,
  getSteps,
  getTask,
  patchArtifact,
  setStepStatus,
  taskDir,
  updateTask,
  upsertWorkflowRun,
} from "./pipeline/repo";

export const ROLLBACK_TARGETS = [
  "book",
  "sources",
  "script",
  "long_title",
  "short_title",
  "style",
  "images",
  "post_production",
  "delivery_review",
  "publication",
] as const;

export type RollbackTarget = (typeof ROLLBACK_TARGETS)[number];

const TARGET_STATE: Record<RollbackTarget, { status: string; gate: string; label: string }> = {
  book: { status: "waiting_confirmation", gate: "BOOK_CONFIRMATION", label: "G00 书名与作者" },
  sources: { status: "ready_for_weread", gate: "WEREAD_HIGHLIGHTS", label: "G01 来源包" },
  script: { status: "waiting_script_confirmation", gate: "SCRIPT_CONFIRMATION", label: "G02 文稿" },
  long_title: { status: "waiting_long_title_confirmation", gate: "LONG_TITLE_CONFIRMATION", label: "G02.1 长标题" },
  short_title: { status: "waiting_short_title_confirmation", gate: "SHORT_TITLE_CONFIRMATION", label: "G02.2 短标题" },
  style: { status: "waiting_style_confirmation", gate: "STYLE_SAMPLE_CONFIRMATION", label: "G03 风格样图" },
  images: { status: "waiting_images_confirmation", gate: "ALL_IMAGES_CONFIRMATION", label: "G04 分镜图片" },
  post_production: { status: "ready_for_post_production", gate: "POST_PRODUCTION", label: "G05 后期制作" },
  delivery_review: { status: "waiting_render_review", gate: "RENDER_REVIEW", label: "G06 成片联合审核" },
  publication: { status: "waiting_publication_confirmation", gate: "PUBLICATION_CONFIRMATION", label: "G08 人工发布信息" },
};

const TARGET_RANK: Record<RollbackTarget, number> = {
  book: 0,
  sources: 1,
  script: 2,
  long_title: 3,
  short_title: 4,
  style: 5,
  images: 6,
  post_production: 6,
  delivery_review: 8,
  publication: 9,
};

const ARTIFACT_RANK: Record<string, number> = {
  weread: 1,
  rewrite: 2,
  text_compliance: 3,
  voice_timeline: 3,
  tts: 3,
  storyboard: 5,
  images: 6,
  subtitle: 7,
  render: 7,
  delivery: 7,
  media_compliance: 8,
  draft_upload: 9,
  publication: 10,
  analytics: 11,
};

function artifactRank(stepName: string, kind: string) {
  if (stepName === "weread" && kind === "popular_highlights") return 2;
  if (stepName === "storyboard" && kind !== "style_sample") return 6;
  return ARTIFACT_RANK[stepName];
}

const STEP_RANK: Partial<Record<StepName, number>> = {
  rewrite: 2,
  text_compliance: 3,
  voice_timeline: 3,
  tts: 3,
  images: 5,
  subtitle: 7,
  render: 7,
  media_compliance: 8,
  draft_upload: 9,
  publication: 10,
  analytics: 11,
};

function parseMeta(raw: string | null | undefined): Record<string, any> {
  try { return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}

function isActiveArtifact(meta: Record<string, any>) {
  return !meta.invalidatedAt;
}

function titleMetaArtifact(taskId: string) {
  return getArtifacts(taskId).find(
    (item) => item.stepName === "rewrite" && item.kind === "json" && isActiveArtifact(parseMeta(item.meta)),
  );
}

function writeTitleMeta(taskId: string, target: RollbackTarget) {
  const artifact = titleMetaArtifact(taskId);
  if (!artifact) return;
  const meta = parseMeta(artifact.meta);
  const next: Record<string, any> = { ...meta, rollbackUpdatedAt: Date.now() };
  if (TARGET_RANK[target] <= TARGET_RANK.script) {
    next.long_title_candidates = [];
    next.video_titles = [];
    next.selected_long_title = "";
    next.short_title_candidates = [];
    next.short_titles = [];
    next.selected_short_title = "";
    next.title_stage = "idle";
  } else if (target === "long_title") {
    next.selected_long_title = "";
    next.short_title_candidates = [];
    next.short_titles = [];
    next.selected_short_title = "";
    next.title_stage = "long_pending";
  } else if (target === "short_title") {
    next.selected_short_title = "";
    next.title_stage = "short_pending";
  }
  patchArtifact(artifact.id, { meta: JSON.stringify(next) });
  fs.writeFileSync(path.join(taskDir(taskId), "titles.json"), JSON.stringify({
    sourceTitle: next.title_source_title || "",
    sourceLength: next.title_source_length || 0,
    formulaSkill: next.title_skill || "dbs-xhs-title",
    stage: next.title_stage || "idle",
    longCandidates: next.long_title_candidates || [],
    selectedLongTitle: next.selected_long_title || "",
    shortCandidates: next.short_title_candidates || [],
    selectedShortTitle: next.selected_short_title || "",
    hashtags: next.hashtags || [],
    updatedAt: Date.now(),
  }, null, 2), "utf8");
}

function prepareEditableScript(taskId: string) {
  const artifacts = getArtifacts(taskId);
  const confirmed = artifacts.find(
    (item) => item.stepName === "rewrite" && item.kind === "confirmed_script" && isActiveArtifact(parseMeta(item.meta)),
  );
  const candidate = artifacts.find(
    (item) => item.stepName === "rewrite" && item.kind === "copy_candidate",
  );
  const scriptPath = path.join(taskDir(taskId), "script.txt");
  const script = String(
    confirmed?.content ||
    (fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, "utf8") : "") ||
    candidate?.content ||
    "",
  ).trim();
  if (!candidate || !script) return;
  const candidatePath = path.join(taskDir(taskId), "script-candidate.txt");
  fs.writeFileSync(candidatePath, `${script}\n`, "utf8");
  const meta = parseMeta(candidate.meta);
  delete meta.invalidatedAt;
  delete meta.invalidatedByRollback;
  delete meta.invalidatedReason;
  patchArtifact(candidate.id, {
    content: script,
    path: candidatePath,
    meta: JSON.stringify({ ...meta, restoredForEditingAt: Date.now() }),
  });
}

function shouldKeepArtifact(target: RollbackTarget, stepName: string, kind: string) {
  if (stepName === "rewrite" && kind === "json") return true;
  if (target === "script" && stepName === "rewrite" && kind === "copy_candidate") return true;
  if (target === "long_title" || target === "short_title") {
    return ["rewrite", "text_compliance", "voice_timeline", "tts"].includes(stepName);
  }
  if (target === "style" && stepName === "storyboard" && kind === "style_sample") return true;
  if (target === "images" && stepName === "storyboard") return true;
  if (target === "post_production" && ["storyboard", "images", "tts", "voice_timeline"].includes(stepName)) return true;
  return false;
}

function invalidateDownstreamArtifacts(taskId: string, target: RollbackTarget, reason: string) {
  const rank = TARGET_RANK[target];
  const now = Date.now();
  let count = 0;
  for (const artifact of getArtifacts(taskId)) {
    const currentArtifactRank = artifactRank(artifact.stepName, artifact.kind);
    const meta = parseMeta(artifact.meta);
    if (
      currentArtifactRank == null ||
      currentArtifactRank <= rank ||
      shouldKeepArtifact(target, artifact.stepName, artifact.kind) ||
      meta.invalidatedAt
    ) continue;
    patchArtifact(artifact.id, {
      meta: JSON.stringify({
        ...meta,
        invalidatedAt: now,
        invalidatedByRollback: target,
        invalidatedReason: reason,
      }),
    });
    count += 1;
  }
  return count;
}

function reopenTargetArtifact(taskId: string, target: RollbackTarget) {
  const now = Date.now();
  for (const artifact of getArtifacts(taskId)) {
    const meta = parseMeta(artifact.meta);
    if (target === "style" && artifact.stepName === "storyboard" && artifact.kind === "style_sample") {
      patchArtifact(artifact.id, {
        meta: JSON.stringify({ ...meta, approvedAt: null, reopenedAt: now }),
      });
    }
    if (target === "images" && artifact.stepName === "storyboard" && artifact.kind === "remaining_image_manifest") {
      patchArtifact(artifact.id, {
        meta: JSON.stringify({ ...meta, approvedAt: null, reopenedAt: now }),
      });
    }
  }
}

function resetStepsAndRuns(taskId: string, target: RollbackTarget, reason: string) {
  const rank = TARGET_RANK[target];
  for (const step of getSteps(taskId)) {
    const stepRank = STEP_RANK[step.name as StepName];
    if (stepRank == null || stepRank <= rank) continue;
    setStepStatus(taskId, step.name as StepName, {
      status: "pending",
      progress: 0,
      output: "",
      error: "",
      startedAt: 0,
      finishedAt: 0,
    });
    upsertWorkflowRun(taskId, step.name, {
      status: "superseded",
      progress: 0,
      message: `因返回修改 ${TARGET_STATE[target].label}，等待重新执行`,
      error: "",
      finishedAt: Date.now(),
    });
  }
}

export function rollbackImpact(taskId: string, target: RollbackTarget) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  const draftExists = getPublicationRecords(taskId).some(
    (item) => ["draft_ready", "published"].includes(item.status),
  );
  const impactByTarget: Record<RollbackTarget, string> = {
    book: "将重新确认书名与作者，并使来源包、文稿、标题、配音、图片、成片及发布流程失效。",
    sources: "将重新选择原文证据，并使文稿、标题、配音、图片、成片及发布流程失效。",
    script: "将恢复为可编辑文稿，并使 C01、标题、配音时间轴、图片、成片及发布流程失效。",
    long_title: "将清空已选长标题和短标题，并使 G03 之后的图片、成片及发布流程失效；已完成配音保留。",
    short_title: "将清空已选短标题，并使 G03 之后的图片、成片及发布流程失效；已完成配音保留。",
    style: "将重新打开当前风格样图审核，并使其余分镜、成片及发布流程失效。",
    images: "将重新打开全部分镜审核，并使字幕、成片、终审及发布流程失效。",
    post_production: "将重新执行字幕、成片、剪映草稿、封面和发布前审核。",
    delivery_review: "将返回 G06 重新检查成片、剪映草稿和封面；已上传到视频号的草稿不会自动删除。",
    publication: "将返回 G08 重新填写人工发布信息和时间；平台上已经发布的作品不会被撤回。",
  };
  return {
    target,
    label: TARGET_STATE[target].label,
    impact: impactByTarget[target],
    externalNotice: draftExists
      ? "视频号中已经存在的草稿或已发布作品不会被自动删除，请在平台后台人工处理。"
      : "",
  };
}

export function rollbackWorkflow(taskId: string, target: RollbackTarget, reason = "用户返回修改") {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  const running = getSteps(taskId).find((step) => step.status === "running");
  const taskBusy = (
    task.status === "running" ||
    task.status.includes("generating") ||
    task.status.endsWith("_queued") ||
    task.status === "rendering_video" ||
    task.status === "uploading_draft"
  );
  if (running || taskBusy) {
    throw new Error("当前节点仍在执行中，请等待完成或先停止任务，再返回修改。");
  }

  if (target === "script") prepareEditableScript(taskId);
  writeTitleMeta(taskId, target);
  const invalidatedArtifacts = invalidateDownstreamArtifacts(taskId, target, reason);
  reopenTargetArtifact(taskId, target);
  resetStepsAndRuns(taskId, target, reason);

  const state = TARGET_STATE[target];
  updateTask(taskId, { status: state.status, currentGate: state.gate });
  return {
    ok: true,
    ...rollbackImpact(taskId, target),
    status: state.status,
    currentGate: state.gate,
    invalidatedArtifacts,
  };
}
