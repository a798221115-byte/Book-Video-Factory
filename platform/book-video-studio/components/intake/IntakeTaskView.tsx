"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import TitleSelectionPanel from "../task-view/TitleSelectionPanel";

type Step = {
  name: string;
  status: string;
  progress: number | null;
  error: string | null;
};

type Artifact = {
  id: string;
  stepName: string;
  kind: string;
  label: string | null;
  path: string | null;
  content: string | null;
  meta: string | null;
};

type TaskData = {
  task: {
    id: string;
    sourceUrl: string;
    title: string | null;
    author: string | null;
    bookTitle: string | null;
    bookAuthor: string | null;
    projectPath: string | null;
    currentGate: string;
    status: string;
    stats?: string | null;
    createdAt?: number;
  };
  steps: Step[];
  artifacts: Artifact[];
};

const intakeSteps = [
  { key: "extract", label: "下载参考视频", hint: "解析抖音信息并保存原视频" },
  { key: "transcribe", label: "提取口播文案", hint: "ASR 转写并生成清洗稿" },
  { key: "analyze", label: "识别图书与结构", hint: "生成书名候选和爆款结构报告" },
];

const copyDirectionPresets = [
  "更克制一些，减少煽情和说教",
  "更口语化，减少书面表达",
  "突出行动感，但不要喊口号",
  "控制在 60 秒左右，节奏紧凑",
];

function parseJson(raw: string | null | undefined) {
  try { return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}

function fileUrl(storedPath: string) {
  const normalized = storedPath.replaceAll("\\", "/").replace(/^\.?\//, "").replace(/^data\//, "");
  return `/api/files/${normalized.split("/").map(encodeURIComponent).join("/")}`;
}

function statusLabel(status: string) {
  if (status === "done") return "已完成";
  if (status === "running") return "进行中";
  if (status === "failed") return "失败";
  return "等待";
}

function demoTaskData(): TaskData {
  const transcript = "你有没有发现，真正让一个人变得强大的，从来不是他能控制多少事情，而是他开始允许一些事情发生。允许关系有聚有散，允许计划偶尔失控，也允许自己在某些时刻不那么完美。";
  const cleanedText = "真正让一个人变得强大的，不是他能控制多少事情，而是开始允许一些事情发生。允许关系有聚有散，允许计划偶尔失控，也允许自己在某些时刻不那么完美。";
  return {
    task: {
      id: "demo",
      sourceUrl: "https://v.douyin.com/demo-book-video",
      title: "一个人真正的强大，是允许一切发生",
      author: "每天读点书",
      bookTitle: null,
      bookAuthor: null,
      projectPath: "work/2026-07-23-douyin-demo01-01",
      currentGate: "BOOK_CONFIRMATION",
      status: "waiting_confirmation",
      stats: JSON.stringify({ likes: 54125, comments: 617, shares: 1869, duration: 68 }),
      createdAt: Date.now() - 42 * 60_000,
    },
    steps: [
      { name: "extract", status: "done", progress: 1, error: null },
      { name: "transcribe", status: "done", progress: 1, error: null },
      { name: "analyze", status: "done", progress: 1, error: null },
    ],
    artifacts: [
      { id: "raw", stepName: "transcribe", kind: "transcript", label: "原始逐字稿", path: null, content: transcript, meta: null },
      { id: "cleaned", stepName: "transcribe", kind: "cleaned", label: "清洗稿", path: null, content: cleanedText, meta: null },
      {
        id: "candidates",
        stepName: "analyze",
        kind: "book_candidates",
        label: "书名作者候选",
        path: null,
        content: null,
        meta: JSON.stringify({
          candidates: [
            { title: "允许一切发生", author: "杨万里", confidence: 0.86, evidence: ["标题与口播核心概念高度一致", "逐字稿多次出现“允许发生”"] },
            { title: "臣服实验", author: "迈克·辛格", confidence: 0.48, evidence: ["观点主题相近，但缺少直接书名证据"] },
          ],
        }),
      },
      {
        id: "analysis",
        stepName: "analyze",
        kind: "viral_structure",
        label: "爆款结构分析",
        path: null,
        content: "# 抖音爆款结构分析\n\n## 开头钩子\n用“你有没有发现”直接召唤观众经验，并把“真正的强大”设置成认知反差。\n\n## 叙事结构\n1. 提出常见误区：强大等于控制。\n2. 给出反转观点：强大来自允许。\n3. 用关系、计划和自我接纳三个生活场景展开。\n4. 把情绪从紧绷带向松弛与释然。\n\n## 可借鉴的表达机制\n- 问句开场，前两句完成观点反转。\n- 抽象观点后立即跟生活场景。\n- 结尾保留余味，不强行推销。",
        meta: null,
      },
    ],
  };
}

export default function IntakeTaskView({ taskId }: { taskId: string }) {
  const demoMode = taskId === "demo";
  const [data, setData] = useState<TaskData | null>(() => demoMode ? demoTaskData() : null);
  const [bookTitle, setBookTitle] = useState("");
  const [bookAuthor, setBookAuthor] = useState("");
  const [selectedHighlightIds, setSelectedHighlightIds] = useState<string[]>([]);
  const [copyDirection, setCopyDirection] = useState("");
  const [candidateScript, setCandidateScript] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (demoMode) return;
    const response = await fetch(`/api/tasks/${taskId}/status`, { cache: "no-store" });
    if (!response.ok) throw new Error("任务状态读取失败");
    const next = await response.json();
    setData(next);
  }, [taskId, demoMode]);

  useEffect(() => {
    load().catch((error) => setMessage(String(error?.message || error)));
  }, [load]);

  useEffect(() => {
    if (!data) return;
    const active =
      data.task.status === "running" ||
      data.task.status === "generating_remaining_images" ||
      data.steps.some((step) => step.status === "running");
    if (!active) return;
    const timer = window.setInterval(() => load().catch(() => {}), 1800);
    return () => window.clearInterval(timer);
  }, [data, load]);

  const artifacts = data?.artifacts || [];
  const video = artifacts.find((item) => item.stepName === "extract" && item.kind === "video");
  const rawTranscript = artifacts.find((item) =>
    item.kind === "transcript" && ["extract", "transcribe"].includes(item.stepName),
  );
  const cleaned = artifacts.find((item) => item.stepName === "transcribe" && item.kind === "cleaned");
  const analysis = artifacts.find((item) => item.stepName === "analyze" && item.kind === "viral_structure");
  const candidateArtifact = artifacts.find((item) => item.stepName === "analyze" && item.kind === "book_candidates");
  const highlightsArtifact = artifacts.find(
    (item) => item.stepName === "weread" && item.kind === "popular_highlights",
  );
  const topHighlightsArtifact = artifacts.find(
    (item) => item.stepName === "weread" && item.kind === "top_highlight_candidates",
  );
  const dbsAnalysisArtifact = artifacts.find(
    (item) => item.stepName === "rewrite" && item.kind === "dbs_analysis",
  );
  const copyCandidateArtifact = artifacts.find(
    (item) => item.stepName === "rewrite" && item.kind === "copy_candidate",
  );
  const copyDirectionArtifact = artifacts.find(
    (item) => item.stepName === "rewrite" && item.kind === "copy_direction",
  );
  const flowAuditArtifact = artifacts.find(
    (item) => item.stepName === "rewrite" && item.kind === "dbs_flow_audit",
  );
  const bookMetaArtifact = artifacts.find(
    (item) => item.stepName === "rewrite" && item.kind === "json",
  );
  const bookMeta = parseJson(bookMetaArtifact?.meta);
  const titleWorkflowComplete = (
    bookMeta.title_stage === "complete" &&
    Boolean(String(bookMeta.selected_long_title || "").trim()) &&
    Boolean(String(bookMeta.selected_short_title || "").trim())
  );
  const styleSampleArtifact = artifacts.find(
    (item) => item.stepName === "storyboard" && item.kind === "style_sample",
  );
  const remainingImageManifestArtifact = artifacts.find(
    (item) => item.stepName === "storyboard" && item.kind === "remaining_image_manifest",
  );
  const remainingImageManifest = parseJson(remainingImageManifestArtifact?.meta);
  const remainingImageJobs = Array.isArray(remainingImageManifest.jobs)
    ? remainingImageManifest.jobs
    : [];
  const completedRemainingImages = remainingImageJobs.filter((item: any) => item.status === "done").length;
  const candidates = useMemo(() => {
    const meta = parseJson(candidateArtifact?.meta);
    return Array.isArray(meta.candidates) ? meta.candidates : [];
  }, [candidateArtifact?.meta]);
  const topHighlightsMeta = useMemo(
    () => parseJson(topHighlightsArtifact?.meta),
    [topHighlightsArtifact?.meta],
  );
  const topHighlights = useMemo(
    () => Array.isArray(topHighlightsMeta.highlights) ? topHighlightsMeta.highlights : [],
    [topHighlightsMeta],
  );
  const wereadBook = topHighlightsMeta.book || {};
  const hasMoreHighlights = Boolean(topHighlightsMeta.hasMore);

  useEffect(() => {
    if (!data) return;
    if (data.task.bookTitle || data.task.bookAuthor) {
      setBookTitle(data.task.bookTitle || "");
      setBookAuthor(data.task.bookAuthor || "");
      return;
    }
    if (candidates[0] && !bookTitle && !bookAuthor) {
      setBookTitle(String(candidates[0].title || ""));
      setBookAuthor(String(candidates[0].author || ""));
    }
  }, [data, candidates, bookTitle, bookAuthor]);

  useEffect(() => {
    const confirmed = parseJson(highlightsArtifact?.meta);
    const confirmedTexts = new Set(
      (Array.isArray(confirmed.highlights) ? confirmed.highlights : [])
        .map((item: any) => String(item.text || "")),
    );
    const visibleIds = new Set(topHighlights.map((item: any) => String(item.id)));
    const confirmedIds = topHighlights
        .filter((item: any) => confirmedTexts.has(String(item.text || "")))
        .map((item: any) => String(item.id));
    setSelectedHighlightIds((current) => Array.from(new Set([
      ...current.filter((id) => visibleIds.has(id)),
      ...confirmedIds,
    ])));
  }, [highlightsArtifact?.meta, topHighlights]);

  useEffect(() => {
    setCandidateScript(copyCandidateArtifact?.content || "");
  }, [copyCandidateArtifact?.id, copyCandidateArtifact?.content]);

  useEffect(() => {
    setCopyDirection(copyDirectionArtifact?.content || "");
  }, [copyDirectionArtifact?.id, copyDirectionArtifact?.content]);

  const run = async (action: "pipeline" | "rerun", step?: string) => {
    if (demoMode) {
      setMessage("演示任务不会运行真实采集。粘贴抖音链接后即可测试完整流程。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, step }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "启动失败");
      setMessage(action === "pipeline" ? "已开始分析，页面会自动刷新。" : "已提交重新运行。");
      window.setTimeout(() => load().catch(() => {}), 500);
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const confirmBook = async () => {
    if (!bookTitle.trim() || !bookAuthor.trim()) {
      setMessage("请先填写并核对书名和作者。");
      return;
    }
    if (demoMode) {
      setData((current) => current ? {
        ...current,
        task: {
          ...current.task,
          bookTitle: bookTitle.trim(),
          bookAuthor: bookAuthor.trim(),
          status: "ready_for_weread",
          currentGate: "WEREAD_HIGHLIGHTS",
        },
      } : current);
      setMessage("演示确认已完成。下一步是 G01 微信读书热门划线。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/book`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookTitle, bookAuthor }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "确认失败");
      setMessage("书名和作者已确认。下一步可以进入微信读书热门划线。");
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const fetchTopHighlights = async (mode: "reset" | "append" = "reset") => {
    if (demoMode) {
      setMessage("演示任务不会调用微信读书，请在正式任务中操作。");
      return;
    }
    setBusy(true);
    setMessage(mode === "append"
      ? "正在按热度继续获取后 10 条热门划线…"
      : "正在微信读书核验版本并获取全书前 10 热门划线…");
    try {
      const response = await fetch(`/api/tasks/${taskId}/weread`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset: mode === "append" ? topHighlights.length : 0,
          limit: 10,
          reset: mode === "reset",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "微信读书热门划线获取失败");
      if (mode === "reset") setSelectedHighlightIds([]);
      setMessage(mode === "append"
        ? `新增 ${payload.batch?.length || 0} 条，已按热度加载 ${payload.loadedCount || 0} 条热门划线。`
        : `已获取《${payload.book?.title || bookTitle}》前 ${payload.loadedCount || 0} 条热门划线，请勾选。`);
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const confirmHighlights = async () => {
    const selected = topHighlights.filter((item: any) =>
      selectedHighlightIds.includes(String(item.id)),
    );
    if (!selected.length) {
      setMessage("请先从已加载的热门划线中至少勾选一条。");
      return;
    }
    if (demoMode) {
      setMessage("演示任务不会保存真实划线，请在正式任务中操作。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/copy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm_highlights",
          highlightsText: selected
            .map((item: any) => `${Number(item.count || 0)}｜${item.chapter || "章节未返回"}｜${item.text}`)
            .join("\n"),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "热门划线确认失败");
      setMessage(`已确认 ${payload.count || 0} 条热门划线，可以生成 DBS 诊断与二创候选稿。`);
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const generateDbsCopy = async () => {
    if (demoMode) {
      setMessage("演示任务不会调用 DeepSeek，请在正式任务中操作。");
      return;
    }
    setBusy(true);
    setMessage("DeepSeek 正在依次执行传播心理、内容诊断、开头方案和完播风险审校…");
    try {
      const response = await fetch(`/api/tasks/${taskId}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: copyDirection }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "DBS 二创生成失败");
      setMessage("候选稿与 DBS 审校已完成，请核对后明确确认文案。");
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const saveCopyDirection = async () => {
    if (demoMode) {
      setMessage("演示任务不会保存微调方向。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/copy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_direction", direction: copyDirection }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "微调方向保存失败");
      setMessage("微调方向已保存，生成或重新生成候选稿时会自动应用。");
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const confirmScript = async () => {
    if (!candidateScript.trim()) {
      setMessage("候选文案不能为空。");
      return;
    }
    if (demoMode) {
      setMessage("演示任务不会写入正式 script.txt。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/copy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm_script", script: candidateScript }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "文案确认失败");
      setMessage("文案已确认并写入 script.txt。下一步先选择长标题，再选择短标题。");
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const confirmStyleSample = async () => {
    if (demoMode) {
      setMessage("演示任务不会确认真实样图。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/style-sample`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "风格样图确认失败");
      setMessage(`风格样图已确认，已创建 ${Number(payload.queued || 0)} 张 Codex 生图任务。页面会显示生成进度。`);
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const startRemainingImages = async () => {
    if (demoMode) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/remaining-images`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "剩余分镜生图任务启动失败");
      setMessage(`已创建 ${Number(payload.manifest?.jobs?.length || 0)} 张 Codex 生图任务。`);
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const confirmAllImages = async () => {
    if (demoMode) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/remaining-images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm_all" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "全部分镜确认失败");
      setMessage("全部分镜图片已确认，后期制作门已解锁。");
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return <main className="intake-detail-shell"><div className="intake-loading">正在读取任务…</div></main>;
  }

  const waitingForBook = data.task.status === "waiting_confirmation";
  const readyForWeread = data.task.status === "ready_for_weread";
  const highlightsConfirmed = data.task.status === "highlights_confirmed";
  const waitingForScript = data.task.status === "waiting_script_confirmation";
  const readyForStyleSample = data.task.status === "ready_for_style_sample";
  const waitingForStyleConfirmation = data.task.status === "waiting_style_confirmation";
  const readyForRemainingImages = data.task.status === "ready_for_remaining_images";
  const generatingRemainingImages = data.task.status === "generating_remaining_images";
  const waitingForImagesConfirmation = data.task.status === "waiting_images_confirmation";
  const readyForPostProduction = data.task.status === "ready_for_post_production";
  const hasFailed = data.steps.some((step) => step.status === "failed");
  const currentIntakeSteps = data.steps.filter((step) =>
    ["extract", "transcribe", "analyze"].includes(step.name),
  );
  const hasRunningIntake = currentIntakeSteps.some((step) => step.status === "running");
  const hasIncompleteIntake = currentIntakeSteps.some((step) =>
    ["pending", "failed"].includes(step.status),
  );
  const canResumeIntake =
    hasIncompleteIntake &&
    !hasRunningIntake &&
    !waitingForBook &&
    !readyForWeread;

  return (
    <main className="intake-detail-shell">
      <header className="intake-detail-header">
        <div>
          <Link href="/">← 返回任务列表</Link>
          <span className="intake-kicker">抖音采集任务</span>
          <h1>{data.task.title || "正在分析抖音视频"}</h1>
          <p>{data.task.author || "账号信息待获取"} · {data.task.projectPath || "工作目录待建立"}</p>
        </div>
        <div className="detail-header-actions">
          <span className={`intake-status ${waitingForBook ? "wait" : readyForWeread ? "ready" : "run"}`}>
            {waitingForBook ? "待确认图书" : readyForWeread ? "可查热门划线" : "采集中"}
          </span>
          <a className="intake-source-link" href={data.task.sourceUrl} target="_blank" rel="noreferrer">打开抖音原链</a>
        </div>
      </header>

      <section className="intake-stage-strip" aria-label="第一版流程进度">
        {intakeSteps.map((item, index) => {
          const step = data.steps.find((value) => value.name === item.key);
          return (
            <div className={`intake-stage ${step?.status || "pending"}`} key={item.key}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{step?.error || item.hint}</small>
              </div>
              <em>{statusLabel(step?.status || "pending")}</em>
              {step?.status === "failed" ? (
                <button disabled={busy} onClick={() => run("rerun", item.key)}>重试</button>
              ) : null}
            </div>
          );
        })}
      </section>

      <section className="detail-production-map" aria-label="图书视频生产流程">
        <div className="detail-production-current">
          <span>当前阶段</span>
          <strong>抖音采集与图书确认</strong>
          <small>确认后才会进入微信读书，后续节点保持锁定。</small>
        </div>
        {[
          ["G01", "热门划线", readyForWeread ? "next" : "locked"],
          ["G02", "原创口播", "locked"],
          ["G03", "风格样图", "locked"],
          ["G04", "全部分镜", "locked"],
          ["G05", "配音后期", "locked"],
          ["G06", "联合审核", "locked"],
        ].map(([gate, label, state]) => (
          <div className={`detail-production-step ${state}`} key={gate}>
            <span>{gate}</span>
            <strong>{label}</strong>
            <small>{state === "next" ? "下一步" : "未解锁"}</small>
          </div>
        ))}
      </section>

      {(data.task.status === "created" || hasFailed || canResumeIntake) && (
        <div className="intake-resume">
          <div>
            <strong>{hasFailed ? "任务需要处理" : "任务尚未启动"}</strong>
            <span>只会运行到图书确认门，不会继续改写或制作视频。</span>
          </div>
          <button disabled={busy || hasRunningIntake} onClick={() => run("pipeline")}>继续分析</button>
        </div>
      )}

      {message ? <div className="intake-message" role="status">{message}</div> : null}

      <div className="intake-evidence-layout">
        <section className="intake-primary-column">
          <div className="intake-section-heading">
            <div><span className="intake-kicker">来源证据</span><h2>参考视频与口播</h2></div>
            <div className="detail-source-metrics">
              {(() => {
                const stats = parseJson(data.task.stats);
                return (
                  <>
                    <span>点赞 <strong>{Number(stats.likes || 0).toLocaleString("zh-CN") || "—"}</strong></span>
                    <span>评论 <strong>{Number(stats.comments || 0).toLocaleString("zh-CN") || "—"}</strong></span>
                    <span>分享 <strong>{Number(stats.shares || 0).toLocaleString("zh-CN") || "—"}</strong></span>
                    <span>时长 <strong>{stats.duration ? `${stats.duration}s` : "—"}</strong></span>
                  </>
                );
              })()}
            </div>
          </div>
          {video?.path ? (
            <video className="intake-video" src={fileUrl(video.path)} controls preload="metadata" />
          ) : (
            <div className="intake-empty compact">视频下载完成后会显示在这里。</div>
          )}

          <div className="intake-transcript-pair">
            <article>
              <h3>原始逐字稿</h3>
              <pre>{rawTranscript?.content || "等待 ASR 转写…"}</pre>
            </article>
            <article>
              <h3>清洗稿</h3>
              <pre>{cleaned?.content || "等待清洗…"}</pre>
            </article>
          </div>

          <article className="intake-analysis">
            <div><span className="intake-kicker">结构参考</span><h2>爆款结构分析</h2></div>
            <pre>{analysis?.content || "完成口播转写后生成。这里仅分析钩子、结构和节奏，不会直接改写新文案。"}</pre>
          </article>
        </section>

        <aside className="intake-confirm-panel">
          <span className="intake-kicker">确认门</span>
          <h2>核对书名和作者</h2>
          <p>只有你明确确认后，任务才能进入微信读书热门划线阶段。</p>
          <div className="detail-evidence-check">
            <span>识别依据</span>
            <strong>标题 + 账号 + 口播逐字稿</strong>
            <small>封面 OCR 将在后续版本补充</small>
          </div>

          {candidates.length ? (
            <div className="intake-candidates">
              {candidates.map((candidate: any, index: number) => (
                <button
                  type="button"
                  key={`${candidate.title}-${index}`}
                  onClick={() => {
                    setBookTitle(candidate.title || "");
                    setBookAuthor(candidate.author || "");
                  }}
                >
                  <strong>《{candidate.title || "未知书名"}》</strong>
                  <span>{candidate.author || "作者待核对"} · {Math.round(Number(candidate.confidence || 0) * 100)}%</span>
                  <small>{Array.isArray(candidate.evidence) ? candidate.evidence.join("；") : ""}</small>
                </button>
              ))}
            </div>
          ) : null}

          <label>
            <span>确认书名</span>
            <input value={bookTitle} onChange={(event) => setBookTitle(event.target.value)} placeholder="请输入准确书名" />
          </label>
          <label>
            <span>确认作者</span>
            <input value={bookAuthor} onChange={(event) => setBookAuthor(event.target.value)} placeholder="请输入准确作者" />
          </label>

          <button
            className="intake-confirm-action"
            type="button"
            disabled={busy || (!waitingForBook && !readyForWeread) || !bookTitle.trim() || !bookAuthor.trim()}
            onClick={confirmBook}
          >
            {readyForWeread ? "更新确认信息" : "确认并进入热门划线"}
          </button>

          {readyForWeread ? (
            <div className="intake-next-gate">
              <strong>可以查询热门划线</strong>
              <span>下方会自动核验微信读书版本，并按热度分批提供热门划线，每次 10 条。</span>
            </div>
          ) : (
            <small>当前状态：{waitingForBook ? "等待你的确认" : "等待分析完成"}</small>
          )}
        </aside>
      </div>

      {(readyForWeread || highlightsConfirmed || waitingForScript || readyForStyleSample) ? (
        <section className="intake-dbs-workspace">
          <div className="intake-section-heading">
            <div>
              <span className="intake-kicker">G01 → G02</span>
              <h2>热门划线与 DeepSeek × DBS 二创</h2>
            </div>
            <span className="intake-dbs-version">dbskill v2.18.4</span>
          </div>

          <div className="intake-dbs-grid">
            <article className="intake-dbs-card">
              <span className="intake-kicker">G01 确认门</span>
              <h3>全书热门划线{topHighlights.length ? `（已加载 ${topHighlights.length} 条）` : ""}</h3>
              <p>根据已确认的书名和作者匹配微信读书版本，按真实划线人数从高到低连续排列。</p>
              <div className="intake-weread-actions">
                <button
                  type="button"
                  className="intake-weread-fetch"
                  disabled={busy || readyForStyleSample}
                  onClick={() => fetchTopHighlights("reset")}
                >
                  {busy ? "正在查询微信读书…" : topHighlights.length ? "重新获取前 10 条" : "获取前 10 条"}
                </button>
                {topHighlights.length && hasMoreHighlights ? (
                  <button
                    type="button"
                    className="intake-weread-fetch intake-weread-more"
                    disabled={busy || readyForStyleSample}
                    onClick={() => fetchTopHighlights("append")}
                  >
                    再获取 10 条
                  </button>
                ) : null}
              </div>
              {topHighlights.length && !hasMoreHighlights ? (
                <small className="intake-weread-pagination-note">已加载当前可获取的全部热门划线。</small>
              ) : null}
              {wereadBook.bookId ? (
                <div className="intake-weread-book">
                  <strong>已匹配：《{wereadBook.title}》</strong>
                  <span>{wereadBook.author}{wereadBook.publisher ? ` · ${wereadBook.publisher}` : ""}</span>
                </div>
              ) : null}
              {topHighlights.length ? (
                <div className="intake-highlight-list">
                  {topHighlights.map((item: any, index: number) => {
                    const id = String(item.id);
                    const checked = selectedHighlightIds.includes(id);
                    return (
                      <label className={checked ? "selected" : ""} key={id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy || readyForStyleSample}
                          onChange={() => setSelectedHighlightIds((current) =>
                            current.includes(id)
                              ? current.filter((value) => value !== id)
                              : [...current, id]
                          )}
                        />
                        <span className="intake-highlight-rank">{index + 1}</span>
                        <span className="intake-highlight-copy">
                          <strong>{item.text}</strong>
                          <small>{item.chapter || "章节未返回"}</small>
                        </span>
                        <em>{Number(item.count || 0).toLocaleString("zh-CN")} 人划线</em>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="intake-highlight-empty">点击上方按钮后，首批 10 条热门划线会显示在这里。</div>
              )}
              <small>已选择 {selectedHighlightIds.length} 条；确认后这些原句才能进入 DBS 二创阶段。</small>
              <button
                type="button"
                className="intake-confirm-action"
                disabled={busy || readyForStyleSample || !selectedHighlightIds.length}
                onClick={confirmHighlights}
              >
                {highlightsArtifact ? "更新并确认所选划线" : "确认所选热门划线"}
              </button>
            </article>

            <article className="intake-dbs-card">
              <span className="intake-kicker">G02 候选稿</span>
              <h3>DBS 诊断与原创口播</h3>
              <p>DeepSeek 会依次执行传播心理解码、五维内容诊断、开头优化和逻辑延续检查，不预测“必爆”。</p>
              <ol>
                <li>只借鉴参考视频的结构、节奏和情绪机制</li>
                <li>直接引用只使用已确认热门划线</li>
                <li>生成后停在文案确认门，不会制作分镜或图片</li>
              </ol>
              <label className="intake-copy-direction">
                <span>微调方向</span>
                <textarea
                  value={copyDirection}
                  maxLength={1000}
                  disabled={busy || readyForStyleSample}
                  onChange={(event) => setCopyDirection(event.target.value)}
                  placeholder="例如：面向容易内耗、行动力不足的职场人；语气更克制，不要过度煽情；重点围绕我选中的第 5 条划线展开；控制在 60 秒左右。"
                />
                <small>{copyDirection.length}/1000 · 生成时自动保存，只控制微小方向，不覆盖事实与引用规则。</small>
              </label>
              <div className="intake-copy-presets">
                {copyDirectionPresets.map((preset) => (
                  <button
                    type="button"
                    key={preset}
                    disabled={busy || readyForStyleSample}
                    onClick={() => setCopyDirection((current) =>
                      current.includes(preset)
                        ? current
                        : [current.trim(), preset].filter(Boolean).join("；")
                    )}
                  >
                    + {preset}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="intake-copy-save"
                disabled={busy || readyForStyleSample}
                onClick={saveCopyDirection}
              >
                保存微调方向
              </button>
              <button
                type="button"
                className="intake-confirm-action"
                disabled={busy || (!highlightsConfirmed && !waitingForScript)}
                onClick={generateDbsCopy}
              >
                {busy ? "DeepSeek 分析中…" : copyCandidateArtifact ? "重新生成 DBS 候选稿" : "生成 DBS 诊断与二创稿"}
              </button>
            </article>
          </div>

          {dbsAnalysisArtifact?.content ? (
            <article className="intake-dbs-output">
              <div>
                <span className="intake-kicker">传播机制与内容诊断</span>
                <h3>为什么原稿有效，哪些只能借机制</h3>
              </div>
              <pre>{dbsAnalysisArtifact.content}</pre>
            </article>
          ) : null}

          {copyCandidateArtifact?.content ? (
            <div className="intake-dbs-review">
              <article className="intake-dbs-output">
                <div>
                  <span className="intake-kicker">候选口播稿</span>
                  <h3>确认前可人工修改</h3>
                </div>
                <textarea
                  value={candidateScript}
                  onChange={(event) => setCandidateScript(event.target.value)}
                  disabled={busy || readyForStyleSample}
                />
                <button
                  type="button"
                  className="intake-confirm-action"
                  disabled={busy || !waitingForScript || !candidateScript.trim()}
                  onClick={confirmScript}
                >
                  确认文案并进入标题选择
                </button>
                <small>确认后才写入正式 script.txt；下一步必须先确认 1 个长标题和 1 个短标题。</small>
              </article>

              <article className="intake-dbs-output">
                <div>
                  <span className="intake-kicker">dbs-script-flow</span>
                  <h3>观众可能划走的位置</h3>
                </div>
                <pre>{flowAuditArtifact?.content || "等待逻辑延续审校…"}</pre>
              </article>
            </div>
          ) : null}

          {readyForStyleSample ? (
            <div className="intake-next-gate">
              <strong>文案已确认</strong>
              <span>{titleWorkflowComplete ? "长短标题已确认，当前停在 G03 风格样图门。" : "当前停在标题选择门：先确认长标题，再确认短标题。"}</span>
            </div>
          ) : null}
        </section>
      ) : null}

      {readyForStyleSample ? (
        <section className="intake-title-selection-workspace">
          <div className="intake-section-heading">
            <div>
              <span className="intake-kicker">G02.1 / G02.2 标题确认门</span>
              <h2>先选长标题，再选短标题</h2>
            </div>
            <span className="intake-dbs-version">dbs-xhs-title</span>
          </div>
          <TitleSelectionPanel task={data.task} book={bookMeta} busy={busy} reload={load} />
        </section>
      ) : null}

      {((readyForStyleSample && titleWorkflowComplete) || waitingForStyleConfirmation || readyForRemainingImages || generatingRemainingImages || waitingForImagesConfirmation || readyForPostProduction) ? (
        <section className="intake-style-sample-workspace">
          <div className="intake-section-heading">
            <div>
              <span className="intake-kicker">G03 风格确认门</span>
              <h2>Codex 代表性风格样图</h2>
            </div>
            <span className="intake-dbs-version">Codex imagegen</span>
          </div>

          {styleSampleArtifact?.path ? (
            <div className="intake-style-sample-grid">
              <figure>
                <img src={fileUrl(styleSampleArtifact.path)} alt="Codex 生成的 G03 风格样图" />
                <figcaption>仅此一张样图；无文字、无书名、无字幕，文字将在后续可编辑轨道中添加。</figcaption>
              </figure>
              <article>
                <span className="intake-kicker">审核要点</span>
                <h3>请确认画风、色彩、人物和构图</h3>
                <ul>
                  <li>文学编辑插画与电影感光线是否合适</li>
                  <li>靛蓝、青绿与暖金色是否符合账号气质</li>
                  <li>人物、倒影和环境是否自然</li>
                  <li>顶部和字幕区域是否保留了自然低信息区</li>
                </ul>
                <button
                  type="button"
                  className="intake-confirm-action"
                  disabled={busy || (!waitingForStyleConfirmation && !readyForRemainingImages)}
                  onClick={waitingForStyleConfirmation ? confirmStyleSample : startRemainingImages}
                >
                  {waitingForStyleConfirmation
                    ? "确认风格并启动 Codex 生图"
                    : readyForRemainingImages
                      ? "启动 Codex 生成剩余图片"
                      : "风格已确认"}
                </button>
                <small>确认后立即创建剩余图片队列；生成结果会逐张回写到下方 G04。</small>
              </article>
            </div>
          ) : (
            <div className="intake-style-sample-empty">
              <strong>等待 Codex 生成一张样图</strong>
              <span>不需要配置第三方图片 API。请在当前 Codex 任务中继续 G03，生成结果会自动写回这里。</span>
            </div>
          )}
        </section>
      ) : null}

      {(readyForRemainingImages || generatingRemainingImages || waitingForImagesConfirmation || readyForPostProduction) ? (
        <section className="intake-remaining-images-workspace">
          <div className="intake-section-heading">
            <div>
              <span className="intake-kicker">G04 全部分镜审核门</span>
              <h2>Codex 剩余分镜图片</h2>
            </div>
            <span className="intake-dbs-version">
              {remainingImageJobs.length ? `${completedRemainingImages}/${remainingImageJobs.length} 已完成` : "等待启动"}
            </span>
          </div>

          {remainingImageJobs.length ? (
            <>
              <div className="intake-image-progress" aria-label="剩余图片生成进度">
                <span style={{ width: `${Math.round((completedRemainingImages / remainingImageJobs.length) * 100)}%` }} />
              </div>
              <div className="intake-remaining-image-grid">
                {remainingImageJobs.map((job: any) => (
                  <figure className={job.status === "done" ? "done" : "pending"} key={job.id}>
                    {job.imagePath ? (
                      <img src={fileUrl(job.imagePath)} alt={`${job.id} ${job.label}`} />
                    ) : (
                      <div className="intake-image-placeholder">
                        <strong>{job.id}</strong>
                        <span>{job.status === "failed" ? job.error || "生成失败" : "等待 Codex 生图"}</span>
                      </div>
                    )}
                    <figcaption>
                      <strong>{job.id} · {job.label}</strong>
                      <span>{job.status === "done" ? "已生成并回写" : "队列中"}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
              <button
                type="button"
                className="intake-confirm-action"
                disabled={busy || !waitingForImagesConfirmation}
                onClick={confirmAllImages}
              >
                {readyForPostProduction ? "全部图片已确认" : "确认全部分镜并进入后期"}
              </button>
              <small>
                {generatingRemainingImages
                  ? "Codex 正在按确认样图生成，完成一张就会在这里出现。"
                  : waitingForImagesConfirmation
                    ? "请逐张检查语义、人物连续性、构图和肢体；确认前不会进入配音后期。"
                    : "当前分镜图片状态已保存。"}
              </small>
            </>
          ) : (
            <div className="intake-style-sample-empty">
              <strong>尚未创建剩余图片队列</strong>
              <button type="button" className="intake-confirm-action" disabled={busy} onClick={startRemainingImages}>
                启动 Codex 生成剩余图片
              </button>
            </div>
          )}
        </section>
      ) : null}

    </main>
  );
}
