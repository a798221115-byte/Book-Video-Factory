"use client";

import Link from "next/link";
import WorkflowExtensionPanel from "./WorkflowExtensionPanel";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
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
  createdAt?: number;
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

function imageRevisionStatusLabel(status: string) {
  if (status === "succeeded") return "修改完成";
  if (status === "failed") return "修改失败";
  if (status === "queued") return "已提交，等待 Codex 启动";
  if (status === "starting") return "Codex 正在启动";
  return "Codex 正在修改";
}

function imageRevisionPhaseLabel(phase: string) {
  const labels: Record<string, string> = {
    queued: "排队中",
    starting: "启动任务",
    thread_created: "已创建 Codex 任务",
    planning: "读取图片和修改意见",
    generating_image: "重新生成图片",
    saving: "写回工作台",
    registering: "登记图片版本",
    completed: "已完成",
    failed: "处理失败",
  };
  return labels[phase] || phase || "处理中";
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
  const [styleFeedback, setStyleFeedback] = useState("");
  const [imageFeedback, setImageFeedback] = useState<Record<string, string>>({});
  const [imageRevisionSubmitting, setImageRevisionSubmitting] = useState<string | null>(null);
  const [candidateScript, setCandidateScript] = useState("");
  const [bookSourceFile, setBookSourceFile] = useState<File | null>(null);
  const [wereadUrl, setWereadUrl] = useState("");
  const [coverHeadline1, setCoverHeadline1] = useState("");
  const [coverHeadline2, setCoverHeadline2] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [styleAction, setStyleAction] = useState<"revise" | "sync" | null>(null);
  const [styleActionNotice, setStyleActionNotice] = useState<{
    tone: "working" | "success" | "error";
    text: string;
  } | null>(null);
  const [activeWorkflowId, setActiveWorkflowId] = useState("workflow-overview");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(140);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const sidebarResizeRef = useRef({ startX: 0, startWidth: 140 });
  const sidebarWidthRef = useRef(140);

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
      data.task.status === "generating_style_sample" ||
      data.task.status === "generating_remaining_images" ||
      data.task.status === "generating_image_revision" ||
      data.steps.some((step) => step.status === "running");
    if (!active) return;
    const timer = window.setInterval(() => load().catch(() => {}), 1800);
    return () => window.clearInterval(timer);
  }, [data, load]);

  useEffect(() => {
    const handleScroll = () => setShowBackToTop(window.scrollY > 480);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem("book-video-detail-sidebar-width"));
    if (Number.isFinite(savedWidth) && savedWidth >= 120 && savedWidth <= 240) {
      sidebarWidthRef.current = savedWidth;
      setSidebarWidth(savedWidth);
    }
  }, []);

  useEffect(() => {
    if (!resizingSidebar) return;
    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = Math.min(
        240,
        Math.max(120, sidebarResizeRef.current.startWidth + event.clientX - sidebarResizeRef.current.startX),
      );
      sidebarWidthRef.current = nextWidth;
      setSidebarWidth(nextWidth);
    };
    const stopResizing = () => {
      setResizingSidebar(false);
      window.localStorage.setItem("book-video-detail-sidebar-width", String(sidebarWidthRef.current));
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };
  }, [resizingSidebar]);

  const artifacts = (data?.artifacts || []).filter(
    (item) => !parseJson(item.meta).invalidatedAt,
  );
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
  const wereadStatusArtifact = artifacts.find(
    (item) => item.stepName === "weread" && item.kind === "weread_status",
  );
  const bookSourceStatusArtifact = artifacts.find(
    (item) => item.stepName === "weread" && item.kind === "book_source_status",
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
  const longTitleConfirmed = Boolean(String(bookMeta.selected_long_title || "").trim());
  const shortTitleConfirmed = Boolean(String(bookMeta.selected_short_title || "").trim());
  const styleSampleArtifact = artifacts.find(
    (item) => item.stepName === "storyboard" && item.kind === "style_sample",
  );
  const codexJobArtifacts = artifacts
    .filter((item) => item.stepName === "storyboard" && item.kind === "codex_job")
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const codexStyleSampleJobArtifact = codexJobArtifacts.find(
    (item) => parseJson(item.meta).jobType === "style_sample",
  );
  const codexStyleSampleJob = parseJson(codexStyleSampleJobArtifact?.meta);
  const codexImageRevisionJobArtifacts = codexJobArtifacts.filter(
    (item) => parseJson(item.meta).jobType === "image_revision",
  );
  const imageRevisionJobsByScene = new Map<string, any>();
  for (const artifact of codexImageRevisionJobArtifacts) {
    const meta = parseJson(artifact.meta);
    if (meta.sceneJobId && !imageRevisionJobsByScene.has(String(meta.sceneJobId))) {
      imageRevisionJobsByScene.set(String(meta.sceneJobId), { artifact, ...meta });
    }
  }
  const codexRemainingImagesJobArtifact = codexJobArtifacts.find(
    (item) => parseJson(item.meta).jobType === "remaining_images",
  );
  const codexRemainingImagesJob = parseJson(codexRemainingImagesJobArtifact?.meta);
  const remainingImageManifestArtifact = artifacts.find(
    (item) => item.stepName === "storyboard" && item.kind === "remaining_image_manifest",
  );
  const remainingImageManifest = parseJson(remainingImageManifestArtifact?.meta);
  const remainingImageJobs = Array.isArray(remainingImageManifest.jobs)
    ? remainingImageManifest.jobs
    : [];
  const completedRemainingImages = remainingImageJobs.filter((item: any) => item.status === "done").length;

  useEffect(() => {
    if (!styleFeedback && codexStyleSampleJob.feedback) {
      setStyleFeedback(String(codexStyleSampleJob.feedback));
    }
  }, [codexStyleSampleJob.feedback, styleFeedback]);
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
  const sourceType = String(topHighlightsMeta.sourceType || "weread");
  const isUploadedBookSource = sourceType === "uploaded_book" || sourceType === "uploaded_epub";
  const hasMoreHighlights = topHighlights.length >= 10 && topHighlightsMeta.hasMore !== false;
  const wereadStatus = parseJson(wereadStatusArtifact?.meta);
  const bookSourceStatus = parseJson(bookSourceStatusArtifact?.meta);

  useEffect(() => {
    const sourceUrl = String(topHighlightsMeta.sourceUrl || "").trim();
    if (sourceUrl) setWereadUrl(sourceUrl);
  }, [topHighlightsMeta.sourceUrl]);

  useEffect(() => {
    if (
      demoMode ||
      data?.task.status !== "ready_for_style_sample" ||
      !titleWorkflowComplete ||
      styleSampleArtifact ||
      codexStyleSampleJobArtifact
    ) return;
    let cancelled = false;
    fetch(`/api/tasks/${taskId}/style-sample`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "enqueue" }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Codex G03 任务派发失败");
        if (!cancelled) await load();
      })
      .catch((error) => {
        if (!cancelled) setMessage(String(error?.message || error));
      });
    return () => { cancelled = true; };
  }, [
    demoMode,
    taskId,
    data?.task.status,
    titleWorkflowComplete,
    styleSampleArtifact,
    codexStyleSampleJobArtifact,
    load,
  ]);

  useEffect(() => {
    if (
      demoMode ||
      data?.task.status !== "generating_remaining_images" ||
      !remainingImageJobs.length ||
      remainingImageJobs.every((item: any) => item.status === "done") ||
      codexRemainingImagesJobArtifact
    ) return;
    let cancelled = false;
    fetch(`/api/tasks/${taskId}/remaining-images`, { method: "POST" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Codex G04 任务派发失败");
        if (!cancelled) await load();
      })
      .catch((error) => {
        if (!cancelled) setMessage(String(error?.message || error));
      });
    return () => { cancelled = true; };
  }, [
    demoMode,
    taskId,
    data?.task.status,
    remainingImageJobs.length,
    completedRemainingImages,
    codexRemainingImagesJobArtifact,
    load,
  ]);

  useEffect(() => {
    if (!data) return;
    const confirmedTitle = data.task.bookTitle || "";
    const confirmedAuthor = data.task.bookAuthor || "";
    if (confirmedTitle || confirmedAuthor) {
      setBookTitle(confirmedTitle);
      setBookAuthor(confirmedAuthor);
      return;
    }
    if (candidates[0]) {
      setBookTitle((current) => current || String(candidates[0].title || ""));
      setBookAuthor((current) => current || String(candidates[0].author || ""));
    }
  }, [data?.task.bookTitle, data?.task.bookAuthor, candidates]);

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
      setMessage("演示确认已完成。下一步是 G01 原文证据。");
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
      setMessage("书名和作者已确认。下一步可以查询微信读书，或上传 EPUB、PDF、TXT 等原书文件。");
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const uploadBookSource = async () => {
    if (!bookSourceFile) {
      setMessage("请先选择 EPUB、PDF、TXT 等原书文件。");
      return;
    }
    if (demoMode) {
      setMessage("演示任务不会上传原书文件，请在正式任务中操作。");
      return;
    }
    setBusy(true);
    setMessage("正在解析原书文件，并由 DeepSeek 筛选与爆款参考文案相关的原书段落…");
    try {
      const formData = new FormData();
      formData.set("file", bookSourceFile);
      const response = await fetch(`/api/tasks/${taskId}/book-source`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "原书文件分析失败");
      setSelectedHighlightIds([]);
      setMessage(`已从 ${payload.paragraphCount || 0} 个原书段落中筛选出 ${payload.loadedCount || 0} 条相关候选，请勾选。`);
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const fetchTopHighlights = async (mode: "reset" | "append" = "reset", directSourceUrl = "") => {
    if (demoMode) {
      setMessage("演示任务不会调用微信读书，请在正式任务中操作。");
      return;
    }
    const sourceUrl = directSourceUrl.trim()
      || (mode === "append" && sourceType === "weread_url" ? wereadUrl.trim() : "");
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
          ...(sourceUrl ? { wereadUrl: sourceUrl } : {}),
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
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const generateDbsCopy = async () => {
    if (demoMode) {
      setMessage("演示任务不会调用 DeepSeek，请在正式任务中操作。");
      return;
    }
    const selected = topHighlights.filter((item: any) =>
      selectedHighlightIds.includes(String(item.id)),
    );
    if (!highlightsConfirmed && !waitingForScript && !selected.length) {
      setMessage("请先从已加载的原文候选中至少勾选一条。");
      return;
    }
    setBusy(true);
    setMessage("正在锁定来源证据；DeepSeek 随后会执行传播心理、内容诊断、开头方案和完播风险审校…");
    try {
      if (!highlightsConfirmed && !waitingForScript) {
        const evidenceResponse = await fetch(`/api/tasks/${taskId}/copy`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "confirm_highlights",
            sourceType,
            highlights: selected,
            highlightsText: selected
              .map((item: any) => `${item.count == null ? "原书" : Number(item.count)}｜${item.chapter || "章节未返回"}｜${item.text}`)
              .join("\n"),
          }),
        });
        const evidencePayload = await evidenceResponse.json().catch(() => ({}));
        if (!evidenceResponse.ok) throw new Error(evidencePayload.error || "来源证据锁定失败");
      }
      const response = await fetch(`/api/tasks/${taskId}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: copyDirection }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "DBS 二创生成失败");
      setMessage("候选稿与 DBS 审校已完成，请进行第 1 次确认：核对并确认文案。");
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
      if (payload.complianceQueued) {
        setMessage("第 1 次确认已完成。C01 通过后将自动选择长短标题、生成真实配音时间轴、风格样图和全部分镜图片。");
        await load();
        return;
      }
      const titleResponse = await fetch(`/api/tasks/${taskId}/titles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_long", autoSelect: true }),
      });
      const titlePayload = await titleResponse.json().catch(() => ({}));
      if (!titleResponse.ok) {
        setMessage(`文案已确认，但长标题生成失败：${titlePayload.error || titleResponse.statusText}。可在标题步骤中重试。`);
        await load();
        return;
      }
      setMessage("第 1 次确认已完成，文案已写入 script.txt；系统正在自动完成标题、配音时间轴和分镜图片。");
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const rollbackWorkflow = async (
    target: "book" | "sources" | "script" | "long_title" | "short_title" | "style" | "images" | "post_production" | "delivery_review" | "publication",
  ) => {
    if (demoMode) {
      setMessage("演示任务不会写入真实回退状态。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const previewResponse = await fetch(`/api/tasks/${taskId}/rollback?target=${target}`, {
        cache: "no-store",
      });
      const preview = await previewResponse.json().catch(() => ({}));
      if (!previewResponse.ok) throw new Error(preview.error || "无法读取回退影响");
      const accepted = window.confirm(
        `确定返回修改「${preview.label}」吗？\n\n${preview.impact}${preview.externalNotice ? `\n\n${preview.externalNotice}` : ""}\n\n旧文件会保留，但下游结果会标记为已失效。`,
      );
      if (!accepted) return;
      const response = await fetch(`/api/tasks/${taskId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          confirmImpact: true,
          reason: `用户从工作台返回修改 ${preview.label}`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "流程回退失败");
      setMessage(`已返回 ${payload.label}。旧产物已保留并标记失效，请修改后重新确认。`);
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

  const retryStyleSample = async () => {
    if (demoMode) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/style-sample`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Codex G03 任务重试失败");
      setMessage("已重新创建 Codex G03 生图任务，页面会持续显示进度。");
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const reviseStyleSample = async () => {
    const feedback = styleFeedback.trim();
    if (!feedback) {
      setMessage("请先填写这张样图需要修改的地方。");
      setStyleActionNotice({ tone: "error", text: "请先填写这张样图需要修改的地方。" });
      return;
    }
    if (demoMode) {
      setMessage("演示任务不会重新生成真实样图。");
      setStyleActionNotice({ tone: "error", text: "演示任务不会重新生成真实样图。" });
      return;
    }
    setStyleAction("revise");
    setStyleActionNotice({ tone: "working", text: "正在提交修改意见并创建新的 Codex 样图任务，请稍候…" });
    setBusy(true);
    setMessage("已提交修改意见，正在创建新的 Codex G03 样图任务…");
    try {
      const response = await fetch(`/api/tasks/${taskId}/style-sample`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revise", feedback }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "G03 样图修改任务创建失败");
      setStyleFeedback("");
      setMessage(`已创建第 ${Number(payload.revision || 2)} 版 G03 样图任务，页面会持续回传进度。`);
      setStyleActionNotice({
        tone: "success",
        text: `第 ${Number(payload.revision || 2)} 版样图任务已创建，接下来会持续显示生成进度。`,
      });
      await load();
    } catch (error: any) {
      const errorMessage = String(error?.message || error);
      setMessage(errorMessage);
      setStyleActionNotice({ tone: "error", text: errorMessage });
    } finally {
      setStyleAction(null);
      setBusy(false);
    }
  };

  const syncStyleSample = async () => {
    if (demoMode) return;
    setStyleAction("sync");
    setStyleActionNotice({ tone: "working", text: "正在检查 Codex 当前任务并同步最新样图，请稍候…" });
    setBusy(true);
    setMessage("正在检查并同步 Codex 当前 G03 样图…");
    try {
      const response = await fetch(`/api/tasks/${taskId}/style-sample`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "G03 样图同步失败");
      const successMessage = payload.message || "已同步 Codex 当前 G03 样图。";
      setMessage(successMessage);
      setStyleActionNotice({ tone: "success", text: successMessage });
      await load();
    } catch (error: any) {
      const errorMessage = String(error?.message || error);
      setMessage(errorMessage);
      setStyleActionNotice({ tone: "error", text: errorMessage });
    } finally {
      setStyleAction(null);
      setBusy(false);
    }
  };

  const reviseStoryboardImage = async (sceneJobId: string) => {
    const feedback = String(imageFeedback[sceneJobId] || "").trim();
    if (!feedback) {
      setMessage("请先填写这张分镜图片需要修改的地方。");
      return;
    }
    if (demoMode) {
      setMessage("演示任务不会重新生成真实分镜图片。");
      return;
    }
    setBusy(true);
    setImageRevisionSubmitting(sceneJobId);
    setMessage(`已提交 ${sceneJobId} 的修改意见，正在创建 Codex 单张图片任务…`);
    try {
      const response = await fetch(`/api/tasks/${taskId}/remaining-images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revise", sceneJobId, feedback }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "单张分镜修改任务创建失败");
      setImageFeedback((current) => ({ ...current, [sceneJobId]: "" }));
      setMessage(`已创建 ${sceneJobId} 的 Codex 修改任务，工作台会持续回传进度。`);
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setImageRevisionSubmitting(null);
      setBusy(false);
    }
  };

  const syncStoryboardImages = async () => {
    if (demoMode) return;
    setBusy(true);
    setMessage("正在检查 Codex 是否直接更新了分镜图片…");
    try {
      const response = await fetch(`/api/tasks/${taskId}/remaining-images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Codex 图片同步失败");
      setMessage(payload.message || "已同步 Codex 图片。");
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

  const retryRemainingImages = async () => {
    if (demoMode) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/remaining-images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Codex G04 任务重试失败");
      setMessage(`已重新创建 Codex G04 任务，将继续生成剩余 ${Number(payload.job?.total || 0) - Number(payload.job?.completed || 0)} 张图片。`);
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
      const productionResponse = await fetch(`/api/tasks/${taskId}/post-production`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const productionPayload = await productionResponse.json().catch(() => ({}));
      if (!productionResponse.ok) {
        setMessage(`第 2 次确认已完成，但自动后期启动失败：${productionPayload.error || productionResponse.statusText}。可在后期区安全重试。`);
        await load();
        return;
      }
      setMessage("第 2 次确认已完成；配音、字幕、成片、剪映草稿、封面和 C02 已自动启动。");
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const startPostProduction = async () => {
    if (demoMode) {
      setMessage("演示任务不会启动真实后期制作。");
      return;
    }
    setBusy(true);
    setMessage("正在启动女声配音、字幕和成片渲染……");
    try {
      const response = await fetch(`/api/tasks/${taskId}/post-production`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          retry: Boolean(
            data?.task.status === "generating_voice" &&
            data.steps.some((step) => step.name === "tts" && step.status === "failed"),
          ),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "后期制作启动失败");
      setMessage("后期制作已启动，工作台会持续回传配音、字幕和成片进度。");
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };


  const generateDeliveryCover = async () => {
    if (demoMode) return;
    setBusy(true);
    setMessage("正在使用微信读书核验书封生成 1080×1260 视频号独立封面…");
    try {
      const response = await fetch(`/api/tasks/${taskId}/delivery-cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline1: coverHeadline1.trim(),
          headline2: coverHeadline2.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "独立封面生成失败");
      setMessage("独立封面已生成并完成基础验收。");
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const refreshDeliveryAssets = async () => {
    if (demoMode) return;
    setBusy(true);
    setMessage("正在重新检查 G06 成片、封面、剪映草稿和验收报告…");
    try {
      const response = await fetch(`/api/tasks/${taskId}/delivery-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "collect" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const missing = Array.isArray(payload.missing) ? payload.missing.join("、") : "";
        throw new Error(missing ? `仍缺少：${missing}` : payload.error || "G06 产物检查失败");
      }
      setMessage("G06 产物已重新检查并登记。");
      await load();
    } catch (error: any) {
      setMessage(String(error?.message || error));
      await load().catch(() => {});
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
  const readyForLongTitles = data.task.status === "ready_for_long_titles";
  const waitingForLongTitleConfirmation = data.task.status === "waiting_long_title_confirmation";
  const readyForShortTitles = data.task.status === "ready_for_short_titles";
  const waitingForShortTitleConfirmation = data.task.status === "waiting_short_title_confirmation";
  const readyForStyleSample = data.task.status === "ready_for_style_sample";
  const generatingStyleSample = data.task.status === "generating_style_sample";
  const waitingForStyleConfirmation = data.task.status === "waiting_style_confirmation";
  const readyForRemainingImages = data.task.status === "ready_for_remaining_images";
  const generatingRemainingImages = data.task.status === "generating_remaining_images";
  const generatingImageRevision = data.task.status === "generating_image_revision";
  const waitingForImagesConfirmation = data.task.status === "waiting_images_confirmation";
  const readyForPostProduction = data.task.status === "ready_for_post_production";
  const generatingVoice = data.task.status === "generating_voice";
  const waitingVoiceConfirmation = data.task.status === "waiting_voice_confirmation";
  const generatingSubtitles = data.task.status === "generating_subtitles";
  const renderingVideo = data.task.status === "rendering_video";
  const voiceFailed = data.task.status === "voice_failed";
  const postProductionFailed = data.task.status === "post_production_failed";
  const staleVoice = generatingVoice && data.steps.some(
    (step) => step.name === "tts" && step.status === "failed",
  );
  const waitingForRenderReview = data.task.status === "waiting_render_review";
  const productionComplete = data.task.status === "done";
  const publishingStageReached = [
    "media_compliance_queued",
    "media_compliance_failed",
    "media_compliance_blocked",
    "ready_for_draft_upload",
    "draft_upload_failed",
    "uploading_draft",
    "waiting_publication_confirmation",
    "analytics_complete",
  ].includes(data.task.status) || data.task.status.startsWith("waiting_analytics_");
  const deliveryStageReached = waitingForRenderReview || productionComplete || publishingStageReached;
  const postProductionReached = readyForPostProduction || deliveryStageReached;
  const postProductionStageReached = postProductionReached || generatingVoice || waitingVoiceConfirmation || generatingSubtitles || renderingVideo || voiceFailed || postProductionFailed;
  const reviewVideoArtifact = artifacts.find(
    (item) => item.stepName === "render" && ["review_video", "video"].includes(item.kind) && item.path,
  );
  const deliveryCoverArtifact = artifacts.find(
    (item) => item.stepName === "delivery" && item.kind === "cover" && item.path,
  );
  const deliveryCoverValidationArtifact = artifacts.find(
    (item) => item.stepName === "delivery" && item.kind === "cover_validation" && item.path,
  );
  const deliveryCoverStatusArtifact = artifacts.find(
    (item) => item.stepName === "delivery" && item.kind === "cover_generation_status",
  );
  const deliveryCoverStatusMeta = parseJson(deliveryCoverStatusArtifact?.meta);
  const deliveryDraftArtifact = artifacts.find(
    (item) => item.stepName === "delivery" && item.kind === "jianying_draft_report" && item.path,
  );
  const deliveryValidationArtifact = artifacts.find(
    (item) => item.stepName === "delivery" && item.kind === "validation_report" && item.path,
  );
  const deliveryDraftMeta = parseJson(deliveryDraftArtifact?.meta);
  const deliveryReady = Boolean(
    reviewVideoArtifact?.path &&
    deliveryCoverArtifact?.path &&
    deliveryDraftArtifact?.path &&
    deliveryValidationArtifact?.path,
  );
  const copyReviewStageReached = [
    "text_compliance_queued",
    "text_compliance_failed",
    "text_compliance_blocked",
    "waiting_voice_timeline",
  ].includes(data.task.status);
  const evidenceStageReached =
    readyForWeread ||
    highlightsConfirmed ||
    waitingForScript ||
    copyReviewStageReached ||
    readyForLongTitles ||
    waitingForLongTitleConfirmation ||
    readyForShortTitles ||
    waitingForShortTitleConfirmation ||
    readyForStyleSample ||
    generatingStyleSample ||
    waitingForStyleConfirmation ||
    readyForRemainingImages ||
    generatingRemainingImages ||
    waitingForImagesConfirmation ||
    postProductionStageReached;
  const evidenceLocked =
    evidenceStageReached &&
    !readyForWeread &&
    !highlightsConfirmed &&
    !waitingForScript;
  const titleSelectionReached =
    readyForLongTitles ||
    waitingForLongTitleConfirmation ||
    readyForShortTitles ||
    waitingForShortTitleConfirmation ||
    readyForStyleSample ||
    generatingStyleSample ||
    waitingForStyleConfirmation ||
    readyForRemainingImages ||
    generatingRemainingImages ||
    generatingImageRevision ||
    waitingForImagesConfirmation ||
    postProductionStageReached;
  const styleStageReached =
    (readyForStyleSample && titleWorkflowComplete) ||
    generatingStyleSample ||
    waitingForStyleConfirmation ||
    readyForRemainingImages ||
    generatingRemainingImages ||
    waitingForImagesConfirmation ||
    postProductionReached;
  const remainingImagesStageReached =
    readyForRemainingImages ||
    generatingRemainingImages ||
    generatingImageRevision ||
    waitingForImagesConfirmation ||
    postProductionStageReached;
  const currentStageLabel = waitingForRenderReview
    ? "G06 自动交付登记"
    : generatingImageRevision
      ? "G04 单张图片修改"
    : postProductionStageReached
      ? "G05 配音后期"
      : remainingImagesStageReached
        ? "G04 全部分镜"
        : styleStageReached
          ? "G03 风格样图"
          : titleSelectionReached
            ? longTitleConfirmed
              ? "G02.2 短标题确认"
              : "G02.1 长标题确认"
          : evidenceStageReached
            ? "G01 来源证据与 G02 文案"
            : "抖音采集与图书确认";
  const currentStatusLabel = waitingForBook
    ? "待确认图书"
      : readyForWeread
        ? "可查热门划线"
      : readyForLongTitles
        ? "正在生成长标题"
      : waitingForLongTitleConfirmation
        ? "兼容旧任务：等待选择长标题"
      : readyForShortTitles
        ? "可生成短标题"
      : waitingForShortTitleConfirmation
        ? "兼容旧任务：等待选择短标题"
      : waitingForRenderReview
        ? "正在自动登记交付产物"
        : generatingImageRevision
          ? "图片修改生成中"
          : generatingVoice
            ? "女声配音生成中"
            : generatingSubtitles
              ? "字幕生成中"
              : renderingVideo
                ? "成片渲染中"
                : readyForPostProduction
                  ? "等待启动后期"
                  : voiceFailed || postProductionFailed
                    ? "后期制作失败"
        : productionComplete
          ? "已完成"
          : evidenceStageReached
            ? "生产流程进行中"
            : "采集中";
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
  const workflowNavigation = [
    { id: "workflow-overview", code: "总览", label: "任务概览", available: true },
    { id: "workflow-evidence", code: "G01", label: "来源证据", available: true },
    { id: "workflow-copy", code: "G02", label: "二创文案", available: evidenceStageReached },
    { id: "workflow-titles", code: "G02.1/2", label: "长短标题", available: titleSelectionReached },
    { id: "workflow-style", code: "G03", label: "风格样图", available: styleStageReached },
    { id: "workflow-images", code: "G04", label: "分镜图片", available: remainingImagesStageReached },
    { id: "workflow-post", code: "G05", label: "配音后期", available: postProductionStageReached },
    { id: "workflow-delivery", code: "G06", label: "自动交付", available: deliveryStageReached },
  ];
  const scrollToWorkflow = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    setActiveWorkflowId(id);
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    target.scrollIntoView({ behavior, block: "start" });
  };
  const scrollToTop = () => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    window.scrollTo({ top: 0, behavior });
  };
  const updateSidebarWidth = (value: number) => {
    const nextWidth = Math.min(240, Math.max(120, value));
    sidebarWidthRef.current = nextWidth;
    setSidebarWidth(nextWidth);
    window.localStorage.setItem("book-video-detail-sidebar-width", String(nextWidth));
  };
  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    sidebarResizeRef.current = { startX: event.clientX, startWidth: sidebarWidthRef.current };
    setResizingSidebar(true);
  };
  const handleSidebarResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      updateSidebarWidth(sidebarWidthRef.current + (event.key === "ArrowRight" ? 8 : -8));
    }
    if (event.key === "Home") updateSidebarWidth(120);
    if (event.key === "End") updateSidebarWidth(240);
  };
  const detailShellStyle = { "--intake-sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  return (
    <main className={`intake-detail-shell ${resizingSidebar ? "is-resizing" : ""}`} style={detailShellStyle}>
      <nav className={`intake-detail-sidebar ${resizingSidebar ? "resizing" : ""}`} aria-label="工作流程导航">
        <Link className="intake-sidebar-home" href="/">
          <span aria-hidden="true">⌂</span>
          返回首页
        </Link>
        <div className="intake-sidebar-title">流程导航</div>
        <div className="intake-sidebar-links">
          {workflowNavigation.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`intake-sidebar-link ${activeWorkflowId === item.id ? "active" : ""}`}
              disabled={!item.available}
              aria-current={activeWorkflowId === item.id ? "location" : undefined}
              onClick={() => scrollToWorkflow(item.id)}
            >
              <span>{item.code}</span>
              <strong>{item.label}</strong>
              <small>{item.available ? "查看" : "待解锁"}</small>
            </button>
          ))}
        </div>
        <div
          className="intake-sidebar-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={120}
          aria-valuemax={240}
          aria-valuenow={sidebarWidth}
          aria-label="调整导航栏宽度"
          title="拖动调整导航栏宽度"
          tabIndex={0}
          onPointerDown={startSidebarResize}
          onKeyDown={handleSidebarResizeKeyDown}
        >
          <span aria-hidden="true" />
        </div>
      </nav>
      <header className="intake-detail-header">
        <div>
          <Link href="/">← 返回任务列表</Link>
          <span className="intake-kicker">抖音采集任务</span>
          <h1>{data.task.title || "正在分析抖音视频"}</h1>
          <p>{data.task.author || "账号信息待获取"} · {data.task.projectPath || "工作目录待建立"}</p>
        </div>
        <div className="detail-header-actions">
          <span className={`intake-status ${waitingForBook ? "wait" : readyForWeread || productionComplete ? "ready" : "run"}`}>
            {currentStatusLabel}
          </span>
          <a className="intake-source-link" href={data.task.sourceUrl} target="_blank" rel="noreferrer">打开抖音原链</a>
        </div>
      </header>

      <section id="workflow-overview" className="intake-stage-strip intake-workflow-anchor" aria-label="第一版流程进度">
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
          <strong>{currentStageLabel}</strong>
          <small>{evidenceStageReached ? "已完成的确认门保持只读，当前阶段与产物继续显示。" : "确认后才会进入微信读书，后续节点保持锁定。"}</small>
        </div>
        {[
          ["G01", "原文证据", highlightsConfirmed || waitingForScript || titleSelectionReached ? "complete" : readyForWeread ? "next" : "locked"],
          ["G02", "原创口播", titleSelectionReached ? "complete" : highlightsConfirmed || waitingForScript ? "next" : "locked"],
          ["G02.1", "10 个长标题", longTitleConfirmed ? "complete" : titleSelectionReached ? "next" : "locked"],
          ["G02.2", "10 个短标题", shortTitleConfirmed ? "complete" : longTitleConfirmed && titleSelectionReached ? "next" : "locked"],
          ["G03", "风格样图", remainingImagesStageReached ? "complete" : styleStageReached ? "next" : "locked"],
          ["G04", "全部分镜", postProductionReached ? "complete" : remainingImagesStageReached ? "next" : "locked"],
          ["G05", "配音后期", deliveryStageReached ? "complete" : readyForPostProduction ? "next" : "locked"],
          ["G06", "自动交付", productionComplete || publishingStageReached ? "complete" : waitingForRenderReview ? "next" : "locked"],
        ].map(([gate, label, state]) => (
          <div className={`detail-production-step ${state}`} key={gate}>
            <span>{gate}</span>
            <strong>{label}</strong>
            <small>{state === "complete" ? "已完成" : state === "next" ? "当前" : "未解锁"}</small>
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

      <div id="workflow-evidence" className="intake-evidence-layout intake-workflow-anchor">
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
          <p>只有你明确确认后，任务才能进入微信读书或原书文件证据阶段。</p>
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
            <input disabled={busy || evidenceLocked} value={bookTitle} onChange={(event) => setBookTitle(event.target.value)} placeholder="请输入准确书名" />
          </label>
          <label>
            <span>确认作者</span>
            <input disabled={busy || evidenceLocked} value={bookAuthor} onChange={(event) => setBookAuthor(event.target.value)} placeholder="请输入准确作者" />
          </label>

          {evidenceLocked ? (
            <button
              type="button"
              className="intake-secondary-action"
              disabled={busy}
              onClick={() => rollbackWorkflow("book")}
            >
              返回修改书名与作者
            </button>
          ) : null}
          <button
            className="intake-confirm-action"
            type="button"
            disabled={busy || (!waitingForBook && !readyForWeread) || !bookTitle.trim() || !bookAuthor.trim()}
            onClick={confirmBook}
          >
            {readyForWeread
              ? "更新确认信息"
              : evidenceStageReached
                ? "书名信息已锁定"
                : "确认并进入热门划线"}
          </button>

          {readyForWeread ? (
            <div className="intake-next-gate">
              <strong>可以查询热门划线</strong>
              <span>优先查询微信读书；没有收录时，可上传 EPUB、PDF、TXT 等原书文件，由 DeepSeek 筛选相关段落。</span>
            </div>
          ) : (
            <small>当前状态：{waitingForBook
              ? "等待你的确认"
              : evidenceStageReached
                ? "已进入后续生产阶段，图书信息已锁定"
                : "等待分析完成"}</small>
          )}
        </aside>
      </div>

      {evidenceStageReached ? (
        <section id="workflow-copy" className="intake-dbs-workspace intake-workflow-anchor">
          <div className="intake-section-heading">
            <div>
              <span className="intake-kicker">G01 → G02</span>
              <h2>原文证据与 DeepSeek × DBS 二创</h2>
            </div>
            <div className="intake-section-heading-actions">
              <button type="button" className="intake-secondary-action" disabled={busy} onClick={() => rollbackWorkflow("book")}>
                返回修改书名
              </button>
              {evidenceLocked ? (
                <button type="button" className="intake-secondary-action" disabled={busy} onClick={() => rollbackWorkflow("sources")}>
                  返回重选原文证据
                </button>
              ) : null}
              <span className="intake-dbs-version">dbskill v2.18.4</span>
            </div>
          </div>

          <div className="intake-dbs-grid">
            <article className="intake-dbs-card">
              <span className="intake-kicker">G01 自动来源包</span>
              <h3>{isUploadedBookSource ? "原书相关段落" : "全书热门划线"}{topHighlights.length ? `（已加载 ${topHighlights.length} 条）` : ""}</h3>
              <p>{isUploadedBookSource
                ? "这些候选来自你上传的原书文件，由 DeepSeek 根据爆款参考文案筛选；不代表微信读书热度。"
                : "根据已确认的书名和作者匹配微信读书版本，按真实划线人数从高到低连续排列。"}</p>
              <div className="intake-weread-actions">
                <button
                  type="button"
                  className="intake-weread-fetch"
                  disabled={busy || evidenceLocked}
                  onClick={() => fetchTopHighlights("reset")}
                >
                  {busy
                    ? "正在处理…"
                    : evidenceLocked
                      ? "热门划线已锁定"
                      : isUploadedBookSource
                        ? "重新查询微信读书"
                        : topHighlights.length
                          ? "重新获取前 10 条"
                          : "获取前 10 条"}
                </button>
                {!isUploadedBookSource && topHighlights.length && hasMoreHighlights ? (
                  <button
                    type="button"
                    className="intake-weread-fetch intake-weread-more"
                    disabled={busy || evidenceLocked}
                    onClick={() => fetchTopHighlights("append")}
                  >
                    再获取 10 条
                  </button>
                ) : null}
              </div>
              {!isUploadedBookSource && topHighlights.length && !hasMoreHighlights ? (
                <small className="intake-weread-pagination-note">已加载当前可获取的全部热门划线。</small>
              ) : null}
              {wereadStatus.status === "unavailable" ? (
                <div className="intake-source-status unavailable">
                  <strong>微信读书未获取到这本书或热门划线</strong>
                  <span>{wereadStatus.detail || wereadStatusArtifact?.content}</span>
                  <div className="intake-weread-url-fallback">
                    <strong>有微信读书地址？可按地址获取</strong>
                    <span>粘贴这本书的微信读书网页链接，系统会直接读取该书版本和热门划线。</span>
                    <div className="intake-weread-url-actions">
                      <input
                        type="url"
                        value={wereadUrl}
                        disabled={busy || evidenceLocked}
                        onChange={(event) => setWereadUrl(event.target.value)}
                        placeholder="https://weread.qq.com/web/reader/..."
                        aria-label="微信读书地址"
                      />
                      <button
                        type="button"
                        disabled={busy || evidenceLocked || !wereadUrl.trim()}
                        onClick={() => fetchTopHighlights("reset", wereadUrl)}
                      >
                        按地址获取热门划线
                      </button>
                    </div>
                    <small>支持微信读书网页阅读链接，也可以直接粘贴包含 bookId 的地址。</small>
                  </div>
                  <small>可改用下方原书文件来源；候选将按与爆款参考文案的相关性排序。</small>
                </div>
              ) : null}
              <div className="intake-book-source-upload">
                <div>
                  <strong>微信读书没有结果？上传原书文件（EPUB、PDF、TXT 等）</strong>
                  <span>DeepSeek 会从原书中找出观点相同、相近或存在逻辑联系的句子和段落。</span>
                </div>
                <input
                  type="file"
                  accept=".epub,.pdf,.txt,.md,.markdown,.html,.htm,.rtf,.docx,application/epub+zip,application/pdf,text/plain,text/markdown,text/html,application/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={busy || evidenceLocked}
                  onChange={(event) => setBookSourceFile(event.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  disabled={busy || evidenceLocked || !bookSourceFile}
                  onClick={uploadBookSource}
                >
                  {busy ? "正在解析与分析…" : "上传并分析原书"}
                </button>
                {bookSourceStatus.status === "failed" ? (
                  <small className="error">上次分析失败：{bookSourceStatus.error || bookSourceStatusArtifact?.content}</small>
                ) : null}
              </div>
              {wereadBook.bookId || isUploadedBookSource ? (
                <div className="intake-weread-book">
                  <strong>{isUploadedBookSource ? "已解析原书" : "已匹配"}：《{wereadBook.title}》</strong>
                  <span>{wereadBook.author}{wereadBook.publisher ? ` · ${wereadBook.publisher}` : ""}{wereadBook.fileName ? ` · ${wereadBook.fileName}` : ""}</span>
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
                          disabled={busy || evidenceLocked}
                          onChange={() => setSelectedHighlightIds((current) =>
                            current.includes(id)
                              ? current.filter((value) => value !== id)
                              : [...current, id]
                          )}
                        />
                        <span className="intake-highlight-rank">{index + 1}</span>
                        <span className="intake-highlight-copy">
                          <strong>{item.text}</strong>
                          <small>{item.chapter || "章节未返回"}{item.relevanceReason ? ` · ${item.relevanceReason}` : ""}</small>
                        </span>
                        <em>{isUploadedBookSource
                          ? `相关度 ${Number(item.relevanceScore || 0)}`
                          : `${Number(item.count || 0).toLocaleString("zh-CN")} 人划线`}</em>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="intake-highlight-empty">可先查询微信读书；没有结果时上传原书文件进行相关性筛选。</div>
              )}
              <small>已选择 {selectedHighlightIds.length} 条；点击生成候选稿时，系统会自动锁定这些可追溯原句并写入来源包。</small>
            </article>

            <article className="intake-dbs-card">
              <span className="intake-kicker">G02 候选稿</span>
              <h3>DBS 诊断与原创口播</h3>
              <p>DeepSeek 会依次执行传播心理解码、五维内容诊断、开头优化和逻辑延续检查，不预测“必爆”。</p>
              <ol>
                <li>只借鉴参考视频的结构、节奏和情绪机制</li>
                <li>直接引用只使用已确认且可追溯的微信读书或原书文件原文</li>
                <li>生成后停在第 1 次确认；确认文案后系统自动推进到全部图片审核</li>
              </ol>
              <label className="intake-copy-direction">
                <span>微调方向</span>
                <textarea
                  value={copyDirection}
                  maxLength={1000}
                  disabled={busy || evidenceLocked}
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
                    disabled={busy || evidenceLocked}
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
                disabled={busy || evidenceLocked}
                onClick={saveCopyDirection}
              >
                保存微调方向
              </button>
              <button
                type="button"
                className="intake-confirm-action"
                disabled={busy || (!highlightsConfirmed && !waitingForScript && !selectedHighlightIds.length)}
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
                  disabled={busy || evidenceLocked}
                />
                {evidenceLocked ? (
                  <button
                    type="button"
                    className="intake-secondary-action"
                    disabled={busy}
                    onClick={() => rollbackWorkflow("script")}
                  >
                    返回修改文稿
                  </button>
                ) : null}
                <button
                  type="button"
                  className="intake-confirm-action"
                  disabled={busy || !waitingForScript || !candidateScript.trim()}
                  onClick={confirmScript}
                >
                  第 1 次确认：确认文案并自动生产
                </button>
                <small>确认后写入正式 script.txt；系统自动完成 C01、长短标题推荐与选择、配音时间轴、样图及全部分镜图片。</small>
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
              <span>{titleWorkflowComplete ? "长短标题已自动采用，系统正在生成风格样图并继续生产。" : "系统正在生成并自动采用长短标题。"}</span>
            </div>
          ) : null}
        </section>
      ) : null}

      {titleSelectionReached ? (
        <section id="workflow-titles" className="intake-title-selection-workspace intake-workflow-anchor">
          <div className="intake-section-heading">
            <div>
              <span className="intake-kicker">G02.1 / G02.2 自动标题</span>
              <h2>系统推荐并自动采用长短标题</h2>
            </div>
            <div className="intake-section-heading-actions">
              <button type="button" className="intake-secondary-action" disabled={busy} onClick={() => rollbackWorkflow("script")}>
                返回修改文稿
              </button>
              {longTitleConfirmed ? (
                <button type="button" className="intake-secondary-action" disabled={busy} onClick={() => rollbackWorkflow("long_title")}>
                  返回重选长标题
                </button>
              ) : null}
              {shortTitleConfirmed ? (
                <button type="button" className="intake-secondary-action" disabled={busy} onClick={() => rollbackWorkflow("short_title")}>
                  返回重选短标题
                </button>
              ) : null}
              <span className="intake-dbs-version">dbs-xhs-title</span>
            </div>
          </div>
          <TitleSelectionPanel
            task={data.task}
            book={bookMeta}
            busy={busy}
            reload={load}
            locked={![
              "ready_for_long_titles",
              "waiting_long_title_confirmation",
              "ready_for_short_titles",
              "waiting_short_title_confirmation",
              "ready_for_style_sample",
            ].includes(data.task.status)}
          />
        </section>
      ) : null}

      {((readyForStyleSample && titleWorkflowComplete) || generatingStyleSample || waitingForStyleConfirmation || readyForRemainingImages || generatingRemainingImages || waitingForImagesConfirmation || postProductionReached) ? (
        <section id="workflow-style" className="intake-style-sample-workspace intake-workflow-anchor">
          <div className="intake-section-heading">
            <div>
              <span className="intake-kicker">G03 自动风格基准</span>
              <h2>Codex 代表性风格样图与自动续跑</h2>
            </div>
            <div className="intake-section-heading-actions">
              <button type="button" className="intake-secondary-action" disabled={busy} onClick={() => rollbackWorkflow("short_title")}>
                返回修改标题
              </button>
              {!waitingForStyleConfirmation && styleSampleArtifact ? (
                <button type="button" className="intake-secondary-action" disabled={busy} onClick={() => rollbackWorkflow("style")}>
                  返回修改风格样图
                </button>
              ) : null}
              <span className="intake-dbs-version">Codex imagegen</span>
            </div>
          </div>

          {styleSampleArtifact?.path && !generatingStyleSample ? (
            <div className="intake-style-sample-grid">
              <figure>
                <img src={fileUrl(styleSampleArtifact.path)} alt="Codex 生成的 G03 风格样图" />
                <figcaption>仅此一张样图；无文字、无书名、无字幕，文字将在后续可编辑轨道中添加。</figcaption>
              </figure>
              <article>
                <span className="intake-kicker">内部质检要点</span>
                <h3>系统以这张图统一画风、色彩、人物和构图</h3>
                <ul>
                  <li>文学编辑插画与电影感光线是否合适</li>
                  <li>靛蓝、青绿与暖金色是否符合账号气质</li>
                  <li>人物、倒影和环境是否自然</li>
                  <li>顶部和字幕区域是否保留了自然低信息区</li>
                </ul>
                {waitingForStyleConfirmation ? (
                  <div className="intake-style-feedback">
                    <label>
                      <span>不满意？告诉 Codex 怎么修改</span>
                      <textarea
                        value={styleFeedback}
                        maxLength={1000}
                        rows={4}
                        disabled={busy}
                        onChange={(event) => setStyleFeedback(event.target.value)}
                        placeholder="例如：人物改为更年轻；减少暖黄色；保留客厅场景，但让两个人的动作更自然；顶部留出更多字幕安全区。"
                      />
                      <small>{styleFeedback.length}/1000 · 只修改画风、色彩、人物、构图和留白，不会改动已确认文案。</small>
                    </label>
                    <button
                      type="button"
                      className="intake-confirm-action intake-style-action-button"
                      disabled={busy || !styleFeedback.trim()}
                      onClick={reviseStyleSample}
                    >
                      {styleAction === "revise" ? (
                        <>
                          <span className="inline-spinner" aria-hidden="true" />
                          正在提交修改…
                        </>
                      ) : "按意见重新生成样图"}
                    </button>
                    <button
                      type="button"
                      className="intake-secondary-action intake-style-action-button"
                      disabled={busy}
                      onClick={syncStyleSample}
                    >
                      {styleAction === "sync" ? (
                        <>
                          <span className="inline-spinner intake-style-action-spinner" aria-hidden="true" />
                          正在同步样图…
                        </>
                      ) : "同步 Codex 当前样图"}
                    </button>
                    {styleActionNotice ? (
                      <div
                        className={`intake-style-action-status ${styleActionNotice.tone}`}
                        role={styleActionNotice.tone === "error" ? "alert" : "status"}
                        aria-live="polite"
                      >
                        <div className="intake-style-action-status-copy">
                          <strong>
                            {styleActionNotice.tone === "working"
                              ? "请求处理中"
                              : styleActionNotice.tone === "success"
                                ? "操作已完成"
                                : "操作未完成"}
                          </strong>
                          <span>{styleActionNotice.text}</span>
                        </div>
                        {styleActionNotice.tone === "working" ? (
                          <div className="intake-style-action-progress" aria-label="操作正在进行">
                            <span />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="intake-confirm-action"
                  disabled={busy || (!waitingForStyleConfirmation && !readyForRemainingImages)}
                  onClick={waitingForStyleConfirmation ? confirmStyleSample : startRemainingImages}
                >
                  {waitingForStyleConfirmation
                    ? "兼容旧任务：采用此风格并继续"
                    : readyForRemainingImages
                      ? "启动 Codex 生成剩余图片"
                      : "风格已确认"}
                </button>
                <small>新任务会自动采用样图并创建剩余图片队列；生成结果逐张回写到下方图片审核区。</small>
              </article>
            </div>
          ) : (
            codexStyleSampleJobArtifact ? (
              <div className="intake-codex-job">
                <div className="intake-codex-job-head">
                  <div>
                    <span className={`intake-codex-state ${codexStyleSampleJob.status || "queued"}`}>
                      {codexStyleSampleJob.status === "failed"
                        ? "生成失败"
                        : codexStyleSampleJob.status === "succeeded"
                          ? "已完成"
                          : codexStyleSampleJob.status === "queued"
                            ? "排队中"
                            : "正在生成"}
                    </span>
                    <strong>{codexStyleSampleJob.message || "Codex 正在处理 G03 风格样图"}</strong>
                  </div>
                  {codexStyleSampleJob.threadId ? (
                    <a
                      className="intake-confirm-action"
                      href={`codex://threads/${codexStyleSampleJob.threadId}`}
                    >
                      在 Codex 中打开任务
                    </a>
                  ) : null}
                </div>
                <div className="intake-image-progress" aria-label="G03 Codex 生成进度">
                  <span style={{ width: `${Math.round(Number(codexStyleSampleJob.progress || 0) * 100)}%` }} />
                </div>
                <div className="intake-codex-job-meta">
                  <span>阶段：{codexStyleSampleJob.phase || "queued"}</span>
                  <span>进度：{Math.round(Number(codexStyleSampleJob.progress || 0) * 100)}%</span>
                  <span>工作台任务：{codexStyleSampleJobArtifact.id}</span>
                  {codexStyleSampleJob.threadId ? <span>Codex：{codexStyleSampleJob.threadId}</span> : null}
                </div>
                {codexStyleSampleJob.error ? (
                  <p className="intake-codex-error">{codexStyleSampleJob.error}</p>
                ) : null}
                {codexStyleSampleJob.status === "failed" ? (
                  <button type="button" className="intake-confirm-action" disabled={busy} onClick={retryStyleSample}>
                    重新创建 Codex 生图任务
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="intake-style-sample-empty">
                <strong>正在创建 Codex G03 任务</strong>
                <span>任务创建后会出现在 Codex 任务列表，并在这里持续回传生成进度。</span>
              </div>
            )
          )}
        </section>
      ) : null}

      {(readyForRemainingImages || generatingRemainingImages || generatingImageRevision || waitingForImagesConfirmation || postProductionReached) ? (
        <section id="workflow-images" className="intake-remaining-images-workspace intake-workflow-anchor">
          <div className="intake-section-heading">
            <div>
              <span className="intake-kicker">第 2 次确认</span>
              <h2>Codex 剩余分镜图片</h2>
            </div>
            <div className="intake-section-heading-actions">
              <button
                type="button"
                className="intake-secondary-action"
                disabled={busy}
                onClick={() => rollbackWorkflow("style")}
              >
                返回修改风格样图
              </button>
              {postProductionStageReached ? (
                <button
                  type="button"
                  className="intake-secondary-action"
                  disabled={busy}
                  onClick={() => rollbackWorkflow("images")}
                >
                  返回修改分镜图片
                </button>
              ) : null}
              <button
                type="button"
                className="intake-secondary-action"
                disabled={busy || generatingImageRevision}
                onClick={syncStoryboardImages}
              >
                同步 Codex 最新图片
              </button>
              <span className="intake-dbs-version">
                {remainingImageJobs.length ? `${completedRemainingImages}/${remainingImageJobs.length} 已完成` : "等待启动"}
              </span>
            </div>
          </div>

          {remainingImageJobs.length ? (
            <>
              {codexRemainingImagesJobArtifact ? (
                <div className="intake-codex-job">
                  <div className="intake-codex-job-head">
                    <div>
                      <span className={`intake-codex-state ${codexRemainingImagesJob.status || "queued"}`}>
                        {codexRemainingImagesJob.status === "failed"
                          ? "生成失败"
                          : codexRemainingImagesJob.status === "succeeded"
                            ? "已完成"
                            : codexRemainingImagesJob.status === "queued"
                              ? "排队中"
                              : "正在生成"}
                      </span>
                      <strong>{codexRemainingImagesJob.message || "Codex 正在生成剩余分镜"}</strong>
                    </div>
                    {codexRemainingImagesJob.threadId ? (
                      <a
                        className="intake-confirm-action"
                        href={`codex://threads/${codexRemainingImagesJob.threadId}`}
                      >
                        在 Codex 中打开任务
                      </a>
                    ) : null}
                  </div>
                  <div className="intake-image-progress" aria-label="G04 Codex 生成进度">
                    <span style={{ width: `${Math.round(Number(codexRemainingImagesJob.progress || 0) * 100)}%` }} />
                  </div>
                  <div className="intake-codex-job-meta">
                    <span>阶段：{codexRemainingImagesJob.phase || "queued"}</span>
                    <span>{Number(codexRemainingImagesJob.completed || 0)}/{Number(codexRemainingImagesJob.total || remainingImageJobs.length)} 张</span>
                    <span>工作台任务：{codexRemainingImagesJobArtifact.id}</span>
                    {codexRemainingImagesJob.threadId ? <span>Codex：{codexRemainingImagesJob.threadId}</span> : null}
                  </div>
                  {codexRemainingImagesJob.error ? (
                    <p className="intake-codex-error">{codexRemainingImagesJob.error}</p>
                  ) : null}
                  {codexRemainingImagesJob.status === "failed" ? (
                    <button type="button" className="intake-confirm-action" disabled={busy} onClick={retryRemainingImages}>
                      保留已完成图片并重试
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="intake-image-progress" aria-label="剩余图片生成进度">
                <span style={{ width: `${Math.round((completedRemainingImages / remainingImageJobs.length) * 100)}%` }} />
              </div>
              <div className="intake-remaining-image-grid">
                {remainingImageJobs.map((job: any) => {
                  const sceneJobId = String(job.id || "");
                  const revisionJob = imageRevisionJobsByScene.get(sceneJobId);
                  const revisionStatus = String(revisionJob?.status || "");
                  const revisionBusy = ["queued", "starting", "running"].includes(revisionStatus);
                  const revisionProgress = Math.max(0, Math.min(1, Number(revisionJob?.progress || 0)));
                  const canRevise = waitingForImagesConfirmation || readyForPostProduction || waitingForRenderReview;
                  return (
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
                      {job.status === "done" && (revisionJob || imageRevisionSubmitting === sceneJobId) ? (
                        <div
                          className={`intake-image-revision-status ${revisionStatus || "queued"}`}
                          role={revisionStatus === "failed" ? "alert" : "status"}
                          aria-live="polite"
                        >
                          <div className="intake-image-revision-status-head">
                            <span className={`intake-codex-state ${revisionStatus || "queued"}`}>
                              {revisionJob ? imageRevisionStatusLabel(revisionStatus) : "正在提交修改"}
                            </span>
                            <strong>
                              {revisionJob?.message || "修改意见正在提交，后台任务即将开始"}
                            </strong>
                          </div>
                          {revisionJob ? (
                            <>
                              <div className="intake-image-revision-progress" aria-label={`${sceneJobId} 单张修改进度`}>
                                <span style={{ width: `${Math.round(revisionProgress * 100)}%` }} />
                              </div>
                              <div className="intake-image-revision-meta">
                                <span>阶段：{imageRevisionPhaseLabel(String(revisionJob.phase || ""))}</span>
                                <span>进度：{Math.round(revisionProgress * 100)}%</span>
                                {revisionJob.artifact?.id ? <span>任务：{revisionJob.artifact.id}</span> : null}
                              </div>
                              {revisionJob.threadId ? (
                                <a href={`codex://threads/${revisionJob.threadId}`} className="intake-codex-thread-link">
                                  在 Codex 中打开这张图的修改任务
                                </a>
                              ) : null}
                              {revisionJob.error ? <small className="intake-codex-error">{revisionJob.error}</small> : null}
                            </>
                          ) : (
                            <div className="intake-image-revision-submitting">
                              <span className="inline-spinner" aria-hidden="true" />
                              页面会自动刷新这张图片的处理进度
                            </div>
                          )}
                        </div>
                      ) : null}
                      {canRevise && job.status === "done" ? (
                        <div className="intake-image-feedback">
                          <textarea
                            value={imageFeedback[sceneJobId] || ""}
                            maxLength={1000}
                            rows={3}
                            disabled={busy || revisionBusy}
                            onChange={(event) => setImageFeedback((current) => ({ ...current, [sceneJobId]: event.target.value }))}
                            placeholder="例如：人物太小；把夕阳改成阴天；减少空旷感；保持同一人物和画风。"
                          />
                          <small>{(imageFeedback[sceneJobId] || "").length}/1000 · 只修改这一张图片，其他分镜不变。</small>
                          <button
                            type="button"
                            className="intake-confirm-action"
                            disabled={busy || revisionBusy || !(imageFeedback[sceneJobId] || "").trim()}
                            onClick={() => reviseStoryboardImage(sceneJobId)}
                          >
                            {imageRevisionSubmitting === sceneJobId ? (
                              <>
                                <span className="inline-spinner" aria-hidden="true" />
                                正在提交修改…
                              </>
                            ) : "按意见修改这张图"}
                          </button>
                        </div>
                      ) : null}
                    </figure>
                  );
                })}
              </div>
              <button
                type="button"
                className="intake-confirm-action"
                disabled={busy || !waitingForImagesConfirmation}
                onClick={confirmAllImages}
              >
                {postProductionReached ? "第 2 次确认已完成" : "第 2 次确认：确认图片并自动完成后期"}
              </button>
              <small>
                {generatingImageRevision
                  ? "单张修改已提交；请查看对应图片卡片的阶段和百分比，完成并显示“修改完成”后再继续 G04 审核。页面会自动刷新进度。"
                  : generatingRemainingImages
                  ? "Codex 正在按确认样图生成，完成一张就会在这里出现。"
                  : waitingForImagesConfirmation
                    ? "请逐张检查语义、人物连续性、构图和肢体；确认后系统自动完成全部后期和交付登记。"
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

      {postProductionStageReached ? (
        <section id="workflow-post" className="intake-style-sample-workspace intake-workflow-anchor" aria-label="G05 配音后期">
          <div className="intake-section-heading">
            <div>
              <span className="intake-kicker">G05 配音后期</span>
              <h2>配音、字幕与成片</h2>
            </div>
            <div className="intake-section-heading-actions">
              <button type="button" className="intake-secondary-action" disabled={busy} onClick={() => rollbackWorkflow("images")}>
                返回修改分镜图片
              </button>
              <span className="intake-dbs-version">female-book-narrator-locked-v1</span>
            </div>
          </div>
          {(() => {
            const ttsStep = data.steps.find((step) => step.name === "tts");
            const subtitleStep = data.steps.find((step) => step.name === "subtitle");
            const renderStep = data.steps.find((step) => step.name === "render");
            const ttsProgress = Number(ttsStep?.progress || 0);
            const subtitleProgress = Number(subtitleStep?.progress || 0);
            const renderProgress = Number(renderStep?.progress || 0);
            const progress = Math.round((ttsProgress * 0.35 + subtitleProgress * 0.25 + renderProgress * 0.4) * 100);
            const running = generatingVoice || generatingSubtitles || renderingVideo;
            const failed = voiceFailed || postProductionFailed || staleVoice;
            const status = waitingForRenderReview
              ? "成片已生成，正在自动登记交付产物"
              : productionComplete || publishingStageReached
                ? "后期制作已完成"
                : failed
                  ? "后期制作失败，可重试"
                  : readyForPostProduction
                    ? "图片已确认，等待启动后期"
                    : waitingVoiceConfirmation
                      ? "等待确认配音"
                      : running
                        ? "后期制作进行中"
                        : "等待后期制作";
            return (
              <div className="intake-codex-job">
                <div className="intake-codex-job-head">
                  <div>
                    <span className={`intake-codex-state ${failed ? "failed" : deliveryStageReached ? "succeeded" : running ? "running" : "queued"}`}>
                      {status}
                    </span>
                    <strong>{failed ? (ttsStep?.error || renderStep?.error || "请点击重试") : "工作台会在每个阶段完成后自动更新这里"}</strong>
                  </div>
                  {(readyForPostProduction || failed) ? (
                    <button type="button" className="intake-confirm-action" disabled={busy} onClick={startPostProduction}>
                      {failed ? "重试后期制作" : "开始配音与后期"}
                    </button>
                  ) : null}
                  {reviewVideoArtifact?.path ? (
                    <a className="intake-confirm-action" href={fileUrl(reviewVideoArtifact.path)} target="_blank" rel="noreferrer">
                      打开成片审核
                    </a>
                  ) : null}
                </div>
                <div className="intake-image-progress" aria-label="G05 后期制作进度">
                  <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
                </div>
                <div className="intake-codex-job-meta">
                  <span>配音：{statusLabel(ttsStep?.status || "pending")}</span>
                  <span>字幕：{statusLabel(subtitleStep?.status || "pending")}</span>
                  <span>成片：{statusLabel(renderStep?.status || "pending")}</span>
                  <span>整体进度：{Math.max(0, Math.min(100, progress))}%</span>
                </div>
              </div>
            );
          })()}
        </section>
      ) : null}

      {deliveryStageReached ? (
        <section id="workflow-delivery" className="intake-style-sample-workspace intake-workflow-anchor" aria-label="G06 自动交付">
          <div className="intake-section-heading">
            <div>
              <span className="intake-kicker">自动交付结果</span>
              <h2>成片、剪映草稿与独立封面</h2>
            </div>
            <div className="intake-section-heading-actions">
              <button type="button" className="intake-secondary-action" disabled={busy} onClick={() => rollbackWorkflow("images")}>
                返回修改分镜图片
              </button>
              <button type="button" className="intake-secondary-action" disabled={busy} onClick={() => rollbackWorkflow("post_production")}>
                返回重做后期
              </button>
              <button type="button" className="intake-secondary-action" disabled={busy} onClick={refreshDeliveryAssets}>
                刷新交付产物
              </button>
              <span className="intake-dbs-version">{deliveryReady ? "产物已齐全" : "产物整理中"}</span>
            </div>
          </div>

          <div className="intake-delivery-grid">
            <article className="intake-delivery-card">
              <strong>60fps 双语字幕审核成片</strong>
              {reviewVideoArtifact?.path ? (
                <>
                  <video src={fileUrl(reviewVideoArtifact.path)} controls preload="metadata" />
                  <a className="intake-confirm-action" href={fileUrl(reviewVideoArtifact.path)} target="_blank" rel="noreferrer">
                    单独打开成片
                  </a>
                </>
              ) : <small>成片仍在渲染。</small>}
            </article>

            <article className="intake-delivery-card">
              <strong>视频号独立封面</strong>
              {deliveryCoverArtifact?.path ? (
                <>
                  <img src={fileUrl(deliveryCoverArtifact.path)} alt="视频号独立封面" />
                  <a className="intake-confirm-action" href={fileUrl(deliveryCoverArtifact.path)} target="_blank" rel="noreferrer">
                    打开封面原图
                  </a>
                </>
              ) : (
                <small>
                  {deliveryCoverStatusMeta.status === "failed"
                    ? `上次生成失败：${deliveryCoverStatusArtifact?.content || "请重试并查看错误"}`
                    : "尚未生成独立封面。可在这里直接生成，不必返回前面的流程。"}
                </small>
              )}
              <div className="intake-cover-generator">
                <label>
                  <span>封面标题第一行</span>
                  <input
                    value={coverHeadline1}
                    onChange={(event) => setCoverHeadline1(event.target.value)}
                    maxLength={13}
                    placeholder="留空则使用系统已采用的短标题"
                  />
                </label>
                <label>
                  <span>封面标题第二行</span>
                  <input
                    value={coverHeadline2}
                    onChange={(event) => setCoverHeadline2(event.target.value)}
                    maxLength={13}
                    placeholder="留空则自动生成克制副标题"
                  />
                </label>
                <button type="button" className="intake-confirm-action" disabled={busy} onClick={generateDeliveryCover}>
                  {deliveryCoverArtifact?.path ? "重新生成独立封面" : "生成独立封面"}
                </button>
                <small>使用微信读书核验的原版书封，外围背景和中文标题由本地脚本确定性合成。</small>
                {deliveryCoverValidationArtifact?.path ? (
                  <a href={fileUrl(deliveryCoverValidationArtifact.path)} target="_blank" rel="noreferrer">
                    查看封面验收报告
                  </a>
                ) : null}
              </div>
            </article>

            <article className="intake-delivery-card intake-delivery-files">
              <strong>可编辑剪映草稿与验收</strong>
              {deliveryDraftArtifact?.path ? (
                <a className="intake-confirm-action" href={fileUrl(deliveryDraftArtifact.path)} target="_blank" rel="noreferrer">
                  查看剪映草稿验收报告
                </a>
              ) : <small>剪映草稿仍在创建。</small>}
              {deliveryValidationArtifact?.path ? (
                <a className="intake-confirm-action" href={fileUrl(deliveryValidationArtifact.path)} target="_blank" rel="noreferrer">
                  查看成片技术验收报告
                </a>
              ) : null}
              {deliveryDraftMeta.nativeDirectory ? (
                <small className="intake-delivery-path">
                  剪映原生草稿：{String(deliveryDraftMeta.nativeDirectory)}
                </small>
              ) : null}
            </article>
          </div>

          <small>
            C02 通过后，成片、剪映草稿、独立封面和验收报告会自动登记；这里用于查看和返工，不再增加第三次确认。
          </small>
        </section>
      ) : null}

      <WorkflowExtensionPanel taskId={taskId} data={data} reload={load} onRollback={rollbackWorkflow} />
      {showBackToTop ? (
        <button type="button" className="intake-back-to-top" onClick={scrollToTop} aria-label="返回顶部">
          <span aria-hidden="true">↑</span>
          返回顶部
        </button>
      ) : null}
    </main>
  );
}
