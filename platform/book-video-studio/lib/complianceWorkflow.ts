import fs from "node:fs";
import path from "node:path";
import { runVisibleCodexTask, type CodexTaskEvent } from "./codexAppServer";
import { startLockedFemaleNarration } from "./lockedFemaleNarration";
import {
  getArtifacts,
  getTask,
  projectArtifactPath,
  saveArtifact,
  setStepStatus,
  taskDir,
  updateTask,
  upsertWorkflowRun,
} from "./pipeline/repo";

export type ComplianceScope = "text" | "media";

const running: Map<string, Promise<void>> =
  ((globalThis as any).__bookVideoComplianceJobs ??= new Map<string, Promise<void>>());

function reportPath(taskId: string, scope: ComplianceScope) {
  return path.join(taskDir(taskId), "compliance", `${scope}-report.json`);
}

function eventProgress(event: CodexTaskEvent) {
  if (event.type === "thread.started") return { progress: 0.12, message: "Codex 主任务已连接" };
  if (event.type === "turn.started") return { progress: 0.2, message: "正在调用发布审核 skill" };
  if (event.type === "item.started") return { progress: 0.45, message: "正在检查内容证据与风险" };
  if (event.type === "item.completed") return { progress: 0.78, message: "正在整理审核结论" };
  if (event.type === "turn.completed") return { progress: 0.92, message: "正在登记审核报告" };
  return { progress: 0.3, message: "合规审核执行中" };
}

function buildPrompt(taskId: string, scope: ComplianceScope, outputPath: string) {
  const task = getTask(taskId)!;
  const projectDir = taskDir(taskId);
  const scriptPath = path.join(projectDir, "script.txt");
  const artifacts = getArtifacts(taskId);
  const reviewVideo = artifacts.find((item) => item.kind === "review_video" && item.path);
  const cover = artifacts.find((item) => item.stepName === "delivery" && item.kind === "cover" && item.path);
  const title = scope === "text" ? "C01 文案合规初审" : "C02 发布前完整审核";
  const evidence = scope === "text"
    ? [`文案：${scriptPath}`]
    : [
        `文案：${scriptPath}`,
        `视频：${reviewVideo?.path || path.join(projectDir, "render")}`,
        `封面：${cover?.path || path.join(projectDir, "cover")}`,
        `字幕与音频目录：${path.join(projectDir, "render")}；${path.join(projectDir, "voice")}`,
        `分镜图片目录：${path.join(projectDir, "storyboard", "images")}`,
        `剪映草稿目录：${path.join(projectDir, "jianying_draft")}`,
      ];
  return [
    `【Book Video Studio｜${title}｜${task.bookTitle || taskId}】`,
    "必须使用 $media-publish-check，目标平台只检查微信视频号。",
    scope === "text"
      ? "这是文本层面初审。不得声称已经检查视频、画面或音轨。"
      : "这是发布前完整审核。检查文案、字幕、封面、关键画面、音轨、AI 标识、权利来源和发布页适配。",
    scope === "media"
      ? "审核成片、独立封面、剪映草稿、字幕或音频任一必需产物不存在时，decision 必须为 block，并精确列出缺失项；不得在模态不完整时给 pass。"
      : "若存在阻断级文案风险，decision 必须为 block。",
    "检查医疗健康表达、极限词、夸大承诺、虚假疗效、导流、商业关系、版权、肖像隐私和 AI 内容标识。",
    "不得自动改写或覆盖原稿。发现高风险问题必须给出精确位置和替换建议。",
    "把审核结果写成严格 JSON，不要写 Markdown，不要省略字段：",
    '{"decision":"pass|block","riskLevel":"low|medium|high","scope":"text|media","summary":"...","issues":[{"severity":"warning|blocking","location":"...","category":"...","evidence":"...","suggestion":"..."}],"requiredDisclosures":["..."],"checkedModalities":["..."],"uncheckedModalities":["..."],"disclaimer":"自动风险评估不代表平台最终审核保证","auditedAt":"ISO-8601"}',
    ...evidence,
    `输出文件绝对路径：${outputPath}`,
    "完成前验证该文件存在且可解析。只做审核，不发布、不上传、不修改素材。",
  ].join("\n");
}

async function runAudit(taskId: string, scope: ComplianceScope) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  const nodeKey = scope === "text" ? "text_compliance" : "media_compliance";
  const outputPath = reportPath(taskId, scope);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  upsertWorkflowRun(taskId, nodeKey, {
    status: "running", progress: 0.05, message: "正在启动 Codex 合规审核",
    error: null, startedAt: Date.now(), finishedAt: null,
  });
  setStepStatus(taskId, nodeKey, {
    status: "running", progress: 0.05, error: "", startedAt: Date.now(),
  });
  await runVisibleCodexTask({
    title: task.bookTitle || task.title || taskId,
    prompt: buildPrompt(taskId, scope, outputPath),
    projectRoot: path.resolve(taskDir(taskId), "..", ".."),
    existingThreadId: task.codexThreadId,
    onEvent: async (event) => {
      const current = eventProgress(event);
      if (event.type === "thread.started") {
        updateTask(taskId, { codexThreadId: event.thread_id });
      }
      upsertWorkflowRun(taskId, nodeKey, {
        status: "running", ...current, updatedAt: Date.now(),
      });
      setStepStatus(taskId, nodeKey, { status: "running", progress: current.progress });
    },
  });
  if (!fs.existsSync(outputPath)) throw new Error("Codex 已结束，但没有生成合规审核报告");
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  if (!["pass", "block"].includes(report.decision)) throw new Error("合规报告 decision 字段无效");
  const storedPath = projectArtifactPath(outputPath);
  saveArtifact({
    taskId,
    stepName: nodeKey,
    kind: "compliance_report",
    label: scope === "text" ? "C01 文案合规初审报告" : "C02 发布前完整审核报告",
    path: storedPath,
    content: JSON.stringify(report, null, 2),
    meta: { decision: report.decision, riskLevel: report.riskLevel, auditedAt: Date.now() },
  });
  upsertWorkflowRun(taskId, nodeKey, {
    status: report.decision === "pass" ? "succeeded" : "blocked",
    progress: 1,
    message: report.summary || (report.decision === "pass" ? "审核通过" : "发现必须处理的问题"),
    artifactPath: storedPath,
    error: null,
    finishedAt: Date.now(),
  });
  setStepStatus(taskId, nodeKey, {
    status: report.decision === "pass" ? "done" : "failed",
    progress: 1,
    output: JSON.stringify({ decision: report.decision, reportPath: storedPath }),
    error: report.decision === "block" ? String(report.summary || "合规审核未通过") : "",
    finishedAt: Date.now(),
  });

  if (scope === "text") {
    if (report.decision === "block") {
      updateTask(taskId, { status: "text_compliance_blocked", currentGate: "TEXT_COMPLIANCE" });
      return;
    }
    updateTask(taskId, { status: "ready_for_long_titles", currentGate: "LONG_TITLE_GENERATION" });
    const internalBaseUrl = process.env.BOOK_VIDEO_STUDIO_INTERNAL_URL
      || `http://127.0.0.1:${process.env.PORT || "3000"}`;
    fetch(`${internalBaseUrl}/api/tasks/${taskId}/titles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate_long", autoSelect: true }),
    }).then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(String(payload?.error || `HTTP ${response.status}`));
      }
    }).catch((error) => {
      console.error("[long-title-generation]", error);
    });
    upsertWorkflowRun(taskId, "voice_timeline", {
      status: "queued", progress: 0, message: "文案合规通过，等待提前配音",
    });
    startLockedFemaleNarration(taskId, { early: true, continuePostProduction: false })
      .then(() => upsertWorkflowRun(taskId, "voice_timeline", {
        status: "succeeded", progress: 1, message: "真实配音时间轴已生成", finishedAt: Date.now(),
      }))
      .catch((error: any) => upsertWorkflowRun(taskId, "voice_timeline", {
        status: "failed", error: String(error?.message || error),
        message: "提前配音失败，可在工作台重试", finishedAt: Date.now(),
      }));
    return;
  }
  if (report.decision !== "pass") {
    updateTask(taskId, { status: "media_compliance_blocked", currentGate: "MEDIA_COMPLIANCE" });
    return;
  }
  updateTask(taskId, { status: "waiting_render_review", currentGate: "DELIVERY_REGISTERING" });
  const internalBaseUrl = process.env.BOOK_VIDEO_STUDIO_INTERNAL_URL
    || `http://127.0.0.1:${process.env.PORT || "3000"}`;
  fetch(`${internalBaseUrl}/api/tasks/${taskId}/delivery-assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "confirm", approvalMode: "automatic" }),
  }).then(async (response) => {
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(String(payload?.error || `HTTP ${response.status}`));
    }
  }).catch((error) => {
    console.error("[automatic-delivery-registration]", error);
  });
}

export function enqueueComplianceAudit(taskId: string, scope: ComplianceScope) {
  const key = `${taskId}:${scope}`;
  if (running.has(key)) return;
  const nodeKey = scope === "text" ? "text_compliance" : "media_compliance";
  upsertWorkflowRun(taskId, nodeKey, {
    status: "queued",
    progress: 0,
    message: scope === "text" ? "C01 文案合规初审已排队" : "C02 发布前完整审核已排队",
    error: null,
    startedAt: null,
    finishedAt: null,
  });
  const job = runAudit(taskId, scope)
    .catch((error: any) => {
      upsertWorkflowRun(taskId, nodeKey, {
        status: "failed", error: String(error?.message || error),
        message: "合规审核执行失败，可重试", finishedAt: Date.now(),
      });
      setStepStatus(taskId, nodeKey, {
        status: "failed", error: String(error?.message || error), finishedAt: Date.now(),
      });
      updateTask(taskId, {
        status: scope === "text" ? "text_compliance_failed" : "media_compliance_failed",
        currentGate: scope === "text" ? "TEXT_COMPLIANCE" : "MEDIA_COMPLIANCE",
      });
    })
    .finally(() => running.delete(key));
  running.set(key, job);
}
