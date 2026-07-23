"use client";

import { IMAGE_MODE_OPTIONS } from "@/lib/imageModes";
import { IMAGE_STYLE_OPTIONS } from "@/lib/imageStyles";

export const STEP_LABELS: Record<string, string> = {
  extract: "热点采集",
  transcribe: "逐字稿修复",
  rewrite: "钩子与候选稿",
  tts: "音频生成",
  subtitle: "字幕对齐",
  images: "AI 场景图",
  render: "成片输出",
};

export const DEPS: Record<string, string[]> = {
  extract: [],
  transcribe: ["extract"],
  rewrite: ["transcribe"],
  tts: ["rewrite"],
  subtitle: ["tts"],
  images: ["rewrite"],
  render: ["subtitle", "tts", "extract", "images"],
};

export const STAGES = [
  { id: "transcribe", label: "逐字稿修复", hint: "把原始转写修复成可读正文" },
  { id: "rewrite", label: "钩子与候选稿", hint: "提炼卖点并改成口播稿" },
  { id: "tts", label: "音频生成", hint: "生成分段配音" },
  { id: "images", label: "AI 场景图", hint: "为文案生成分镜画面" },
  { id: "book", label: "书籍信息", hint: "确认书名、作者和证据" },
  { id: "style", label: "成片风格与数量", hint: "选择背景、字幕和产出数量" },
  { id: "render", label: "成片输出", hint: "合成 final.mp4" },
  { id: "review", label: "日志 / 人工确认", hint: "检查异常并人工放行" },
];

export const MAX_RENDER_VIDEOS = 6;
export const IMAGE_MODES = IMAGE_MODE_OPTIONS;
export const IMAGE_STYLES = IMAGE_STYLE_OPTIONS;

export function stepForStage(id: string) {
  if (id === "book") return "rewrite";
  if (id === "style") return "render";
  if (id === "review") return "render";
  return id;
}

export function fileUrl(p: string): string {
  const rel = p.replace(/^\.?\/?data\//, "");
  return "/api/files/" + rel.split("/").map(encodeURIComponent).join("/");
}

export function parseJson(raw: string | null | undefined) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function fmtDuration(sec: unknown) {
  const n = Number(sec || 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function statusCopy(status: string) {
  if (status === "done") return "已完成";
  if (status === "running") return "当前";
  if (status === "failed") return "异常";
  return "待办";
}

export function summarizeStepError(error: unknown, maxLength = 180) {
  const text = String(error || "").replace(/\s+/g, " ").trim();
  if (!text) return "未返回错误详情";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function nextHint(id: string) {
  if (id === "transcribe") return "撰写钩子与候选稿";
  if (id === "rewrite") return "生成音频与 AI 场景图";
  if (id === "tts") return "对齐字幕，AI 场景图可同步生成";
  if (id === "images") return "对齐字幕并确认成片风格";
  if (id === "render") return "下载 final.mp4";
  return "进入下一环节";
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
