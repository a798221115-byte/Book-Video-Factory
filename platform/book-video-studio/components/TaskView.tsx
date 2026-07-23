"use client";
import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import AudioWorkspace from "./task-view/AudioWorkspace";
import BookIdentityWorkspace from "./task-view/BookIdentityWorkspace";
import RewriteWorkspace from "./task-view/RewriteWorkspace";
import ImageGenerationWorkspace from "./task-view/ImageGenerationWorkspace";
import VideoStylesWorkspace from "./task-view/VideoStylesWorkspace";
import PreflightPanel from "./task-view/PreflightPanel";
import VideoCoverWorkspace from "./task-view/VideoCoverWorkspace";
import DedupWorkspace from "./task-view/DedupWorkspace";
import OutputPanel, { TextPanel } from "./task-view/OutputPanel";
import ToastHost, { useToasts } from "./task-view/ToastHost";
import { DEPS, STAGES, STEP_LABELS, fmtDuration, nextHint, parseJson, statusCopy, stepForStage, summarizeStepError } from "./task-view/shared";
import { DEFAULT_TTS_SPEED } from "@/lib/steps/ttsSpeed";

async function requestJson(label: string, input: RequestInfo | URL, init: RequestInit | undefined, onError: (detail: string) => void) {
  try {
    const r = await fetch(input, init);
    const text = await r.text();
    let payload: any = {};
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = { message: text }; }
    }
    if (!r.ok) {
      throw new Error(String(payload?.error || payload?.message || `${r.status} ${r.statusText}`));
    }
    return payload;
  } catch (e: any) {
    onError(String(e?.message || e));
    return null;
  }
}

type StepSnapshot = {
  status: string;
  error: string;
  finishedAt: number | null;
};

const DEFAULT_STYLE_COUNTS = {
  clean: 0,
  black: 0,
  card: 0,
  book: 0,
  showcase: 0,
  notes: 0,
  quote: 0,
  chapters: 1,
  desk: 0,
};

const DEFAULT_MOTION_PRESETS = {
  cinematic: false,
  quick: true,
  calm: false,
  collage: false,
};

const OLD_DEFAULT_STYLE_COUNTS = {
  clean: 0,
  black: 0,
  card: 1,
  book: 0,
  showcase: 0,
  notes: 0,
  quote: 0,
  chapters: 0,
  desk: 0,
};

const OLD_DEFAULT_MOTION_PRESETS = {
  cinematic: true,
  quick: false,
  calm: false,
  collage: false,
};

const BOOK_QUICK_DEFAULT_STYLE_COUNTS = {
  clean: 0,
  black: 0,
  card: 0,
  book: 1,
  showcase: 0,
  notes: 0,
  quote: 0,
  chapters: 0,
  desk: 0,
};

const BOOK_QUICK_DEFAULT_MOTION_PRESETS = {
  cinematic: false,
  quick: true,
  calm: false,
  collage: false,
};

const GENERATED_COVER_SETS: Record<string, { label: string; url: string }[]> = {
  "与神对话": [
    { label: "灵性星光", url: "/ai-covers/yushenduihua-01-celestial.png" },
    { label: "水墨文学", url: "/ai-covers/yushenduihua-02-editorial.png" },
    { label: "电影写作桌", url: "/ai-covers/yushenduihua-03-cinematic.png" },
    { label: "抽象几何", url: "/ai-covers/yushenduihua-04-abstract.png" },
  ],
};

function samePreset(value: any, preset: Record<string, number | boolean>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(preset).every(([key, expected]) => value[key] === expected || Number(value[key]) === Number(expected));
}

function normalizedBookKey(value: unknown) {
  return String(value || "").replace(/[《》\s,，。:：]/g, "").trim();
}

function generatedCoverCandidates(bookTitle: unknown) {
  const key = normalizedBookKey(bookTitle);
  return Object.entries(GENERATED_COVER_SETS).find(([title]) => normalizedBookKey(title) === key)?.[1] || [];
}

function mergeArtifactPayload(prevArtifacts: any[] = [], nextArtifacts: any[] = []) {
  if (!Array.isArray(nextArtifacts)) return nextArtifacts;
  const previous = new Map(prevArtifacts.map((artifact: any) => [artifact.id, artifact]));
  return nextArtifacts.map((artifact: any) => {
    const old = previous.get(artifact.id);
    if (!old) return artifact;
    return {
      ...old,
      ...artifact,
      content: artifact.contentMissing ? old.content : artifact.content,
      meta: artifact.metaMissing ? old.meta : artifact.meta,
    };
  });
}

function needsFullArtifactPayload(prevArtifacts: any[] = [], nextArtifacts: any[] = []) {
  if (!Array.isArray(nextArtifacts)) return false;
  const previous = new Map(prevArtifacts.map((artifact: any) => [artifact.id, artifact]));
  return nextArtifacts.some((artifact: any) => {
    const old = previous.get(artifact.id);
    if (artifact.contentMissing && (!old?.content || old.contentSig !== artifact.contentSig)) return true;
    if (artifact.metaMissing && (!old?.meta || old.metaSig !== artifact.metaSig)) return true;
    return false;
  });
}

export default function TaskView({ taskId }: { taskId: string }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [bookDraft, setBookDraft] = useState({ bookTitle: "", bookAuthor: "", coverUrl: "" });
  const [rewriteConfig, setRewriteConfig] = useState({ notes: "" });
  const [ttsConfig, setTtsConfig] = useState({ voice: "常用", speed: String(DEFAULT_TTS_SPEED) });
  const [titleSeed, setTitleSeed] = useState(0);
  const [imageTarget, setImageTarget] = useState("auto");
  const [imageMode, setImageMode] = useState("square");
  const [imageStyle, setImageStyle] = useState("photo");
  const [imageQuality, setImageQuality] = useState("high");
  const [regeneratingImageId, setRegeneratingImageId] = useState("");
  const [styleCounts, setStyleCounts] = useState<Record<string, number>>(DEFAULT_STYLE_COUNTS);
  const [motionPresets, setMotionPresets] = useState<Record<string, boolean>>(DEFAULT_MOTION_PRESETS);
  const [renderEngine, setRenderEngine] = useState("auto");
  const [statement, setStatement] = useState("本视频基于{author}《{title}》及相关研究资料整理\n仅用于健康科普分享，不构成任何建议或行为指导。");
  const [streamKey, setStreamKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const { toasts, notify, dismissToast } = useToasts();
  const hashScrollTargetRef = useRef("");
  const stepSnapshotsRef = useRef<Record<string, StepSnapshot>>({});
  const notifiedFailuresRef = useRef<Set<string>>(new Set());
  const loadingFullPayloadRef = useRef(false);
  const formConfigSig = Array.isArray(data?.artifacts)
    ? data.artifacts
      .filter((a: any) => (
        (a.stepName === "rewrite" && a.kind === "json") ||
        (a.stepName === "extract" && a.kind === "json") ||
        (a.stepName === "config" && a.kind === "json")
      ))
      .map((a: any) => `${a.id}:${a.stepName}:${a.kind}:${a.metaSig || ""}`)
      .join("|")
    : "";

  const applyTaskData = useCallback((payload: any) => {
    if (Array.isArray(payload?.steps)) {
      const previous = stepSnapshotsRef.current;
      const next: Record<string, StepSnapshot> = {};

      for (const step of payload.steps) {
        const name = String(step?.name || "");
        if (!name) continue;

        const status = String(step?.status || "pending");
        const error = String(step?.error || "");
        const finishedAt = typeof step?.finishedAt === "number" ? step.finishedAt : null;
        const prev = previous[name];
        const failureKey = `${name}:${finishedAt || ""}:${error}`;

        if (prev?.status === "running" && status === "failed" && !notifiedFailuresRef.current.has(failureKey)) {
          notifiedFailuresRef.current.add(failureKey);
          notify({
            tone: "error",
            title: `${STEP_LABELS[name] || name}失败`,
            detail: summarizeStepError(error),
          });
        }

        next[name] = { status, error, finishedAt };
      }

      stepSnapshotsRef.current = next;
    }

    let shouldLoadFullPayload = false;
    setData((prev: any) => {
      shouldLoadFullPayload = needsFullArtifactPayload(prev?.artifacts, payload?.artifacts);
      return {
        ...payload,
        artifacts: mergeArtifactPayload(prev?.artifacts, payload?.artifacts),
      };
    });

    if (shouldLoadFullPayload && !loadingFullPayloadRef.current) {
      loadingFullPayloadRef.current = true;
      fetch(`/api/tasks/${taskId}/status`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((full) => {
          if (full) {
            setData((prev: any) => ({
              ...full,
              artifacts: mergeArtifactPayload(prev?.artifacts, full?.artifacts),
            }));
          }
        })
        .finally(() => {
          loadingFullPayloadRef.current = false;
        });
    }
  }, [notify, taskId]);

  useEffect(() => {
    stepSnapshotsRef.current = {};
    notifiedFailuresRef.current = new Set();
  }, [taskId]);

  const requestTaskJson = useCallback((label: string, input: RequestInfo | URL, init?: RequestInit) => {
    return requestJson(label, input, init, (detail) => notify({
      tone: "error",
      title: `${label}失败`,
      detail,
    }));
  }, [notify]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/tasks/${taskId}/status`, { cache: "no-store" });
    if (r.ok) applyTaskData(await r.json());
  }, [taskId, applyTaskData]);

  useEffect(() => {
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    let ended = false;

    const startPolling = () => {
      if (poll || stopped || ended) return;
      load();
      poll = setInterval(load, 1500);
    };

    try {
      es = new EventSource(`/api/tasks/${taskId}/stream`);
      es.addEventListener("state", (ev: MessageEvent) => {
        try { applyTaskData(JSON.parse(ev.data)); } catch { /* ignore */ }
      });
      es.addEventListener("end", () => { ended = true; es?.close(); });
      es.onerror = () => {
        es?.close();
        es = null;
        startPolling();
      };
    } catch {
      startPolling();
    }
    load();

    return () => {
      stopped = true;
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [taskId, load, streamKey]);

  useEffect(() => {
    if (!data) return;
    const bookArtifact = data.artifacts.find((a: any) => a.stepName === "rewrite" && a.kind === "json");
    const bookMeta = parseJson(bookArtifact?.meta);
    const extractArtifact = data.artifacts.find((a: any) => a.stepName === "extract" && a.kind === "json");
    const extractMeta = parseJson(extractArtifact?.meta);
    setBookDraft({
      bookTitle: data.task.bookTitle || bookMeta.book_title || "",
      bookAuthor: data.task.bookAuthor || bookMeta.book_author || "",
      coverUrl: bookMeta.cover_url || extractMeta.coverUrl || extractMeta.cover_url || "",
    });

    const ttsConfigArtifact = data.artifacts.find((a: any) => {
      if (a.stepName !== "config" || a.kind !== "json" || !a.meta) return false;
      try { return JSON.parse(a.meta).key === "tts"; } catch { return false; }
    });
    const ttsConfigMeta = parseJson(ttsConfigArtifact?.meta);
    const savedTts = ttsConfigMeta.value || {};
    const savedVoice = savedTts.voice === "default" || savedTts.voice === "自用"
      ? "default"
      : savedTts.voice === "warm"
        ? "常用"
      : savedTts.voice === "bright"
        ? "女声自用"
        : savedTts.voice || "常用";
    setTtsConfig({
      voice: savedVoice,
      speed: savedTts.speed || String(DEFAULT_TTS_SPEED),
    });

    const imageConfigArtifact = data.artifacts.find((a: any) => {
      if (a.stepName !== "config" || a.kind !== "json" || !a.meta) return false;
      try { return JSON.parse(a.meta).key === "images"; } catch { return false; }
    });
    const imageConfigMeta = parseJson(imageConfigArtifact?.meta);
    const savedImages = imageConfigMeta.value || {};
    if (Number(savedImages.targetCount) > 0) setImageTarget(String(savedImages.targetCount));
    else if ("targetCount" in savedImages) setImageTarget("auto");
    if (savedImages.mode === "wide" || savedImages.mode === "square") setImageMode(savedImages.mode);
    if (["photo", "illustration", "oil_painting", "watercolor", "film"].includes(savedImages.style)) setImageStyle(savedImages.style);
    if (savedImages.quality === "fast" || savedImages.quality === "high") setImageQuality(savedImages.quality);

    const renderConfigArtifact = data.artifacts.find((a: any) => {
      if (a.stepName !== "config" || a.kind !== "json" || !a.meta) return false;
      try { return JSON.parse(a.meta).key === "render"; } catch { return false; }
    });
    const renderConfigMeta = parseJson(renderConfigArtifact?.meta);
    const savedRender = renderConfigMeta.value || {};
    const savedStyleCounts = savedRender.styleCounts || savedRender.styles;
    const savedMotionPresets = savedRender.motionPresets || savedRender.motions;
    const isOldDefaultRender =
      (
        samePreset(savedStyleCounts, OLD_DEFAULT_STYLE_COUNTS) &&
        samePreset(savedMotionPresets, OLD_DEFAULT_MOTION_PRESETS)
      ) ||
      (
        samePreset(savedStyleCounts, BOOK_QUICK_DEFAULT_STYLE_COUNTS) &&
        samePreset(savedMotionPresets, BOOK_QUICK_DEFAULT_MOTION_PRESETS)
      );
    if (savedStyleCounts && typeof savedStyleCounts === "object") {
      setStyleCounts((prev) => ({ ...prev, ...(isOldDefaultRender ? DEFAULT_STYLE_COUNTS : savedStyleCounts) }));
    }
    if (savedMotionPresets && typeof savedMotionPresets === "object") {
      setMotionPresets((prev) => ({ ...prev, ...(isOldDefaultRender ? DEFAULT_MOTION_PRESETS : savedMotionPresets) }));
    }
    if (savedRender.engine === "hyperframes" || savedRender.engine === "ffmpeg" || savedRender.engine === "auto") {
      setRenderEngine(savedRender.engine);
    } else {
      setRenderEngine("auto");
    }
    if (typeof savedRender.statement === "string") setStatement(savedRender.statement);

    const rewriteConfigArtifact = data.artifacts.find((a: any) => {
      if (a.stepName !== "config" || a.kind !== "json" || !a.meta) return false;
      try { return JSON.parse(a.meta).key === "rewrite"; } catch { return false; }
    });
    const rewriteConfigMeta = parseJson(rewriteConfigArtifact?.meta);
    const savedRewrite = rewriteConfigMeta.value || {};
    setRewriteConfig({
      notes: typeof savedRewrite.notes === "string"
        ? savedRewrite.notes
        : typeof savedRewrite.rewriteNotes === "string"
          ? savedRewrite.rewriteNotes
          : "",
    });
  }, [data?.task?.id, data?.task?.bookTitle, data?.task?.bookAuthor, formConfigSig]);

  useEffect(() => {
    if (!data?.task?.id || window.location.hash !== "#rewrite") return;
    const key = `${taskId}:rewrite`;
    if (hashScrollTargetRef.current === key) return;
    hashScrollTargetRef.current = key;
    requestAnimationFrame(() => {
      document.getElementById("rewrite")?.scrollIntoView({ block: "start" });
    });
  }, [data?.task?.id, taskId]);

  useEffect(() => {
    const hasRunningStep = Array.isArray(data?.steps) && data.steps.some((step: any) => step?.status === "running");
    if (!hasRunningStep) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [data?.steps]);

  const act = async (action: string, step?: string) => {
    const label = action === "pipeline" ? "启动全链" : `启动${STEP_LABELS[step || ""] || step || "任务"}`;
    setBusy(true);
    try {
      const result = await requestTaskJson(label, `/api/tasks/${taskId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, step }),
      });
      if (!result) return false;
      setStreamKey((k) => k + 1);
      await load();
      return true;
    } finally {
      setTimeout(() => setBusy(false), 600);
    }
  };

  const saveArtifact = async (artifactId: string, content: string) => {
    setBusy(true);
    try {
      const j = await requestTaskJson("保存文本", `/api/tasks/${taskId}/artifacts/${artifactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!j) return false;
      setEditing((e) => { const n = { ...e }; delete n[artifactId]; return n; });
      await load();
      const ds = (j.invalidatedDownstream || []).map((n: string) => STEP_LABELS[n] || n).join("、");
      notify({
        tone: "success",
        title: "文本已保存",
        detail: ds ? `下游步骤（${ds}）已重置，请重新运行。` : undefined,
      });
      return true;
    } finally {
      setTimeout(() => setBusy(false), 400);
    }
  };

  const saveBookInfo = async (payload: { bookTitle: string; bookAuthor: string; coverUrl: string; videoTitles: string[]; shortTitles: string[]; hashtags: string[] }) => {
    setBusy(true);
    try {
      const result = await requestTaskJson("保存书籍信息", `/api/tasks/${taskId}/book`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!result) return false;
      await load();
      notify({ tone: "success", title: "书籍信息已保存" });
      return true;
    } finally {
      setTimeout(() => setBusy(false), 400);
    }
  };

  const saveTaskConfig = async (key: string, value: any, label = "保存配置") => {
    const savedLabel = label.replace(/^保存/, "") || "配置";
    const result = await requestTaskJson(label, `/api/tasks/${taskId}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (result) notify({ tone: "success", title: `${savedLabel}已保存` });
    return Boolean(result);
  };

  const regenerateImage = async (artifactId: string) => {
    setRegeneratingImageId(artifactId);
    setBusy(true);
    try {
      const result = await requestTaskJson("单图重生成", `/api/tasks/${taskId}/images/${artifactId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style: imageStyle }),
      });
      if (!result) return false;
      await load();
      notify({
        tone: "success",
        title: "单图已重生成",
        detail: result?.regeneratedAt ? `已生成新版本 ${new Date(result.regeneratedAt).toLocaleTimeString()}` : undefined,
      });
      return true;
    } finally {
      setRegeneratingImageId("");
      setTimeout(() => setBusy(false), 500);
    }
  };

  const confirmCleaned = async () => {
    if (!(await saveTaskConfig("review", { cleanedConfirmedAt: Date.now() }, "保存清洗确认"))) return;
    await act("run", "rewrite");
  };

  if (!data) {
    return (
      <>
        <ToastHost toasts={toasts} onDismiss={dismissToast} />
        <div className="flow-loading">
          <div className="spin flow-spinner" />
          <span>加载任务...</span>
        </div>
      </>
    );
  }

  const { task, steps, artifacts } = data;
  const stepMap = new Map<string, any>(steps.map((s: any) => [s.name, s]));
  const artifactsByStep = (name: string) => artifacts.filter((a: any) => a.stepName === name);
  const bookArt = artifacts.find((a: any) => a.stepName === "rewrite" && a.kind === "json");
  const book = parseJson(bookArt?.meta);
  const titleWorkflowComplete = (
    book.title_stage === "complete" &&
    Boolean(String(book.selected_long_title || "").trim()) &&
    Boolean(String(book.selected_short_title || "").trim())
  );
  const isReady = (name: string) => (
    (DEPS[name] || []).every((d) => stepMap.get(d)?.status === "done") &&
    (name !== "images" || titleWorkflowComplete)
  );
  const extractMeta = parseJson(artifacts.find((a: any) => a.stepName === "extract" && a.kind === "json")?.meta);
  const title = task.title || extractMeta.title || task.sourceUrl;
  const author = task.author || extractMeta.author || "-";
  const required = ["extract", "transcribe", "rewrite", "tts", "images", "subtitle", "render"];
  const completed = required.filter((name) => stepMap.get(name)?.status === "done").length;
  const progress = Math.round((completed / required.length) * 100);
  const renderStep = stepMap.get("render");
  const renderError = renderStep?.status === "failed" ? summarizeStepError(renderStep.error) : "";
  const getStageStatus = (stageId: string) => {
    if (stageId === "review") return "pending";
    if (stageId === "book") {
      if (stepMap.get("rewrite")?.status !== "done") return "pending";
      return titleWorkflowComplete ? "done" : "running";
    }
    if (stageId === "style") {
      if (["running", "done", "failed"].includes(renderStep?.status || "")) return "done";
      return isReady("render") ? "running" : "pending";
    }
    const step = stepForStage(stageId);
    return stepMap.get(step)?.status || "pending";
  };
  const firstActive = STAGES.find((stage) => {
    if (stage.id === "review") return false;
    const st = getStageStatus(stage.id);
    return st !== "done";
  }) || STAGES[STAGES.length - 2];
  const activeIndex = STAGES.findIndex((s) => s.id === firstActive.id);
  const activeStep = stepForStage(firstActive.id);
  const activeStepState = stepMap.get(activeStep);
  const activeStepError = activeStepState?.status === "failed" ? summarizeStepError(activeStepState.error) : "";
  const runningStepState = steps.find((step: any) => step?.status === "running");
  const workflowRunning = !!runningStepState;
  const detailStep = runningStepState?.name || activeStep;
  const detailStepState = runningStepState || activeStepState;
  const activeElapsedSec = detailStepState?.status === "running" && detailStepState.startedAt
    ? Math.max(0, Math.round((now - detailStepState.startedAt) / 1000))
    : 0;
  const progressDetail = detailStepState?.status === "running"
    ? `${STEP_LABELS[detailStep] || detailStep}进行中 · 已运行 ${fmtDuration(activeElapsedSec)}`
    : detailStepState?.status === "failed"
      ? `${STEP_LABELS[detailStep] || detailStep}失败`
      : detailStepState?.status === "done"
        ? `${STEP_LABELS[detailStep] || detailStep}已完成`
        : `${STEP_LABELS[detailStep] || detailStep}待开始`;
  const renderArts = artifactsByStep("render");
  const renderDepOrder = ["extract", "tts", "images", "subtitle"];
  const renderMissing = renderDepOrder
    .filter((name) => (DEPS.render || []).includes(name))
    .filter((name) => stepMap.get(name)?.status !== "done")
    .map((name) => STEP_LABELS[name] || name);
  const transcriptArt = artifacts.find((a: any) => a.stepName === "transcribe" && (a.kind === "transcript" || a.kind === "cleaned"));
  const cleanedArt = artifacts.find((a: any) => a.stepName === "transcribe" && a.kind === "cleaned") || transcriptArt;
  const rewriteArt = artifacts.find((a: any) => a.stepName === "rewrite" && a.kind === "rewrite");
  const rewriteSegmentsArt = artifacts.find((a: any) => a.stepName === "rewrite" && a.kind === "segments");
  const rewriteSegmentsMeta = parseJson(rewriteSegmentsArt?.meta);
  const rewriteSegmentCount = Array.isArray(rewriteSegmentsMeta.segments) ? rewriteSegmentsMeta.segments.length : 0;
  const sourceCoverUrl = book.cover_url || extractMeta.coverUrl || extractMeta.cover_url || "";
  const generatedCovers = generatedCoverCandidates(task.bookTitle || book.book_title || bookDraft.bookTitle);
  const ttsArt = artifacts.find((a: any) => a.stepName === "tts" && a.kind === "audio");
  const ttsMeta = parseJson(ttsArt?.meta);
  const videoCover = artifacts
    .filter((a: any) => a.stepName === "images" && a.kind === "video_cover" && a.path)
    .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  const runCompanionImages = async () => {
    const imageStep = stepMap.get("images");
    if (!isReady("images") || imageStep?.status === "done" || imageStep?.status === "running") return true;
    const targetCount = imageTarget === "auto" ? 0 : Number(imageTarget) || 0;
    if (!(await saveTaskConfig("images", { targetCount, mode: imageMode === "wide" ? "wide" : "square", style: imageStyle, quality: imageQuality === "fast" ? "fast" : "high" }, "保存图片配置"))) return false;
    return await act(imageStep?.status === "failed" ? "rerun" : "run", "images");
  };

  return (
    <div className="flow-shell">
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
      <aside className="flow-sidebar">
        <div className="flow-side-title">
          <span>新任务</span>
          <strong>详情</strong>
        </div>
        <Link className="back-hot" href="/">返回热点采集</Link>
        <div className="side-stage-list">
          {STAGES.map((stage, index) => {
            const st = getStageStatus(stage.id);
            const isActive = index === activeIndex || st === "running";
            return (
              <button
                key={stage.id}
                className={`side-stage ${isActive ? "active" : ""} ${st}`}
                type="button"
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <em>{stage.label}</em>
                <small>{statusCopy(st)}</small>
              </button>
            );
          })}
        </div>
        <div className="side-card">
          <span>当前任务</span>
          <strong>#{taskId.slice(0, 2).toUpperCase()}</strong>
          <p>{task.status === "done" ? "已成片" : task.status === "failed" ? "异常待处理" : "待混剪"}</p>
        </div>
        <div className="side-card">
          <span>流程策略</span>
          <strong>{task.status === "failed" ? "异常才人工介入" : "自动优先"}</strong>
          <p>逐字稿修复，再驱动音频、图片、风格批量生成。</p>
        </div>
      </aside>

      <section className="flow-main">
        <div className="flow-hero">
          <div className="flow-hero-copy">
            <div className="flow-kicker">TASK DETAIL / NEW FLOW</div>
            <h1>{title}</h1>
            <div className="flow-submeta">
              <span>{author}</span>
              {book.book_title && <span>《{book.book_title}》</span>}
              <span>#{taskId.slice(0, 8)}</span>
            </div>
          </div>
          <div className="flow-actions">
            <Link className="btn btn-ghost" href="/">返回热点采集</Link>
            <button className="btn btn-ghost" onClick={() => window.location.reload()}>打开旧页面</button>
            <button className="btn btn-ok" disabled={busy} onClick={() => act("pipeline")}>刷新任务</button>
          </div>
        </div>

        <div className="flow-stepper">
          <div className="stepper-row">
            {STAGES.map((stage, index) => {
              const st = getStageStatus(stage.id);
              const isActive = index === activeIndex || st === "running";
              return (
                <div key={stage.id} className={`flow-step-card ${st} ${isActive ? "active" : ""}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{stage.label}</strong>
                  <em>{statusCopy(st)}</em>
                </div>
              );
            })}
          </div>
          <div className="flow-progress-text">
            第 {activeIndex + 1} 步 / 共 {STAGES.length} 步 · 进度 <strong>{progress}%</strong> · {progressDetail}
          </div>
          <div className="stepper-next-hint">完成后 · {nextHint(firstActive.id)}</div>
        </div>

        <AudioWorkspace
          scriptText={rewriteArt?.content || cleanedArt?.content || transcriptArt?.content || ""}
          ttsArt={ttsArt}
          ttsMeta={ttsMeta}
          ttsStep={stepMap.get("tts")}
          rewriteSegmentsMeta={rewriteSegmentsMeta}
          config={ttsConfig}
          setConfig={setTtsConfig}
          renderCount={renderArts.filter((a: any) => a.kind === "video").length}
          busy={busy}
          canRun={isReady("tts")}
          act={act}
          saveTaskConfig={saveTaskConfig}
          runCompanionImages={runCompanionImages}
        />

        <CurrentStage
          active={firstActive}
          stepMap={stepMap}
          isReady={isReady}
          busy={busy}
          act={act}
          status={getStageStatus(firstActive.id)}
          stepError={activeStepError}
        />

        <RewriteWorkspace
          task={task}
          book={book}
          config={rewriteConfig}
          setConfig={setRewriteConfig}
          busy={busy}
          canRun={isReady("rewrite")}
          act={act}
          saveTaskConfig={saveTaskConfig}
        />

        <BookIdentityWorkspace
          task={task}
          book={book}
          draft={bookDraft}
          setDraft={setBookDraft}
          scriptText={rewriteArt?.content || cleanedArt?.content || title}
          titleSeed={titleSeed}
          setTitleSeed={setTitleSeed}
          busy={busy}
          canIdentify={isReady("rewrite")}
          act={act}
          saveBookInfo={saveBookInfo}
          rewriteConfig={rewriteConfig}
          saveTaskConfig={saveTaskConfig}
          sourceCoverUrl={sourceCoverUrl}
          generatedCovers={generatedCovers}
          reload={load}
        />

        <VideoCoverWorkspace
          taskId={taskId}
          task={task}
          book={book}
          videoCover={videoCover}
          rewriteText={rewriteArt?.content || cleanedArt?.content || transcriptArt?.content || ""}
          busy={busy}
          setBusy={setBusy}
          load={load}
        />

        <ImageGenerationWorkspace
          images={artifactsByStep("images").filter((a: any) => a.kind === "image")}
          imageStep={stepMap.get("images")}
          segmentCount={rewriteSegmentCount}
          videoCover={videoCover}
          target={imageTarget}
          setTarget={setImageTarget}
          mode={imageMode}
          setMode={setImageMode}
          style={imageStyle}
          setStyle={setImageStyle}
          quality={imageQuality}
          setQuality={setImageQuality}
          busy={busy}
          regeneratingImageId={regeneratingImageId}
          canRun={isReady("images")}
          blockedReason={!titleWorkflowComplete ? "请先确认 1 个长标题和 1 个短标题" : ""}
          act={act}
          saveTaskConfig={saveTaskConfig}
          regenerateImage={regenerateImage}
        />

        <PreflightPanel
          task={task}
          book={book}
          rewriteText={rewriteArt?.content || ""}
          rewriteSegmentsMeta={rewriteSegmentsMeta}
          ttsArt={ttsArt}
          ttsMeta={ttsMeta}
          subtitleReady={stepMap.get("subtitle")?.status === "done"}
          images={artifactsByStep("images").filter((a: any) => a.kind === "image")}
          videoCover={videoCover}
          imageTarget={imageTarget}
          imageMode={imageMode}
          imageStyle={imageStyle}
          imageQuality={imageQuality}
          styleCounts={styleCounts}
          motionPresets={motionPresets}
          statement={statement}
          renderMissing={renderMissing}
        />

        <VideoStylesWorkspace
          task={task}
          book={book}
          counts={styleCounts}
          setCounts={setStyleCounts}
          motions={motionPresets}
          setMotions={setMotionPresets}
          engine={renderEngine}
          setEngine={setRenderEngine}
          statement={statement}
          setStatement={setStatement}
          renderStep={renderStep}
          renderCount={renderArts.filter((a: any) => a.kind === "video").length}
          renderMissing={renderMissing}
          imageTarget={imageTarget}
          imageMode={imageMode}
          imageStyle={imageStyle}
          imageQuality={imageQuality}
          busy={busy}
          workflowRunning={workflowRunning}
          canRender={isReady("render")}
          act={act}
          saveTaskConfig={saveTaskConfig}
        />

        <section className="work-section">
          <div className="section-head">
            <div>
              <div className="section-kicker">TRANSCRIPT REPAIR</div>
              <h2>修复型清洗</h2>
            </div>
            <div className="section-actions">
              <button className="btn btn-ghost" disabled={busy || !isReady("transcribe")} onClick={() => act("run", "transcribe")}>手动清洗逐字稿</button>
              <button className="btn btn-ok" disabled={busy || !cleanedArt} onClick={confirmCleaned}>确认清洗结果</button>
            </div>
          </div>

          <div className="repair-grid">
            <TextPanel
              title="原始逐字稿"
              badge={transcriptArt?.content ? "发现 2 类问题" : "等待写入"}
              artifact={transcriptArt}
              editing={editing}
              setEditing={setEditing}
              saveArtifact={saveArtifact}
              busy={busy}
            />
            <TextPanel
              title="修复后正文"
              badge={cleanedArt?.content ? "已写入任务" : "等待生成"}
              artifact={cleanedArt}
              editing={editing}
              setEditing={setEditing}
              saveArtifact={saveArtifact}
              busy={busy}
              tone="ok"
            />
          </div>
        </section>

        <section className="work-section">
          <div className="section-head">
            <div>
              <div className="section-kicker">PIPELINE OUTPUTS</div>
              <h2>后续产物</h2>
            </div>
            <button className="btn btn-primary" disabled={busy} onClick={() => act("pipeline")}>一键继续全链</button>
          </div>
          {renderError && (
            <div className="dedup-error" role="alert">
              <strong>成片输出失败：</strong>{renderError}
            </div>
          )}
          <div className="output-grid">
            <OutputPanel title="候选口播稿" step="rewrite" artifacts={rewriteArt ? [rewriteArt] : []} editing={editing} setEditing={setEditing} saveArtifact={saveArtifact} busy={busy} />
            <OutputPanel title="音频与字幕" step="tts" artifacts={artifactsByStep("tts").concat(artifactsByStep("subtitle"))} editing={editing} setEditing={setEditing} saveArtifact={saveArtifact} busy={busy} />
            <OutputPanel title="成片输出" step="render" artifacts={artifactsByStep("render")} editing={editing} setEditing={setEditing} saveArtifact={saveArtifact} busy={busy} />
          </div>
        </section>

        <DedupWorkspace
          taskId={taskId}
          hasCleaned={!!cleanedArt?.content}
          dedupArt={artifacts.find((a: any) => a.stepName === "dedup" && a.kind === "text")}
          book={book}
          busy={busy}
          setBusy={setBusy}
          load={load}
        />
      </section>
    </div>
  );
}

function CurrentStage({ active, stepMap, isReady, busy, act, status, stepError }: any) {
  const step = stepForStage(active.id);
  const s = stepMap.get(step);
  const st = status || s?.status || "pending";
  const ready = isReady(step);
  return (
    <section className="current-stage">
      <div>
        <span>STEP {String(STAGES.findIndex((x) => x.id === active.id) + 1).padStart(2, "0")}</span>
        <h2>{active.label}</h2>
        <p>{active.hint}</p>
        <strong>完成后：{nextHint(active.id)}</strong>
        {stepError && <div className="dedup-error" role="alert">失败原因：{stepError}</div>}
      </div>
      <div className="current-stage-actions">
        {st === "done" && <button className="btn btn-ghost" disabled={busy} onClick={() => act("rerun", step)}>重跑本步</button>}
        {st === "failed" && <button className="btn btn-danger" disabled={busy} onClick={() => act("rerun", step)}>重试</button>}
        {st !== "done" && st !== "failed" && (
          <button className="btn btn-primary" disabled={busy || !ready} onClick={() => act("run", step)}>
            {ready ? "运行当前步骤" : "等待上游"}
          </button>
        )}
      </div>
    </section>
  );
}
