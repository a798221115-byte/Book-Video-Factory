import { getTask, setStepStatus, saveArtifact, getArtifacts, clearArtifacts, taskDir } from "../pipeline/repo";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const execFileP = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN?.trim() || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_BIN?.trim() || "ffprobe";
const RENDER_CRF = process.env.RENDER_CRF?.trim() || "19";
const RENDER_PRESET = process.env.RENDER_PRESET?.trim() || "veryfast";

// HyperFrames 合成模板（离线 HTML timeline），render 时复制到任务目录注入路径
const HF_TEMPLATE = path.resolve(process.cwd(), "lib/hyperframes/template/index.html");
const HF_PACKAGE_DIR = path.resolve(process.cwd(), "node_modules/hyperframes");
const HF_PACKAGE_JSON = path.join(HF_PACKAGE_DIR, "package.json");
const hfFontFaceCache = new Map<string, string>();

type CommandSpec = {
  cmd: string;
  args: string[];
  display: string;
};

function splitCommand(raw: string): string[] {
  const matches = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return matches.map((token) => {
    const quote = token[0];
    return (quote === `"` || quote === `'`) && token[token.length - 1] === quote
      ? token.slice(1, -1)
      : token;
  });
}

function findExecutableOnPath(cmd: string): string | null {
  const paths = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  for (const dir of paths) {
    for (const ext of exts) {
      const candidate = path.join(dir, process.platform === "win32" && !cmd.toUpperCase().endsWith(ext) ? `${cmd}${ext}` : cmd);
      try {
        fs.accessSync(candidate, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return null;
}

function normalizeConfiguredCommand(cmd: string, raw: string): string {
  const hasPath = path.isAbsolute(cmd) || cmd.includes("/") || cmd.includes("\\");
  if (!hasPath) {
    if (!findExecutableOnPath(cmd)) {
      throw new Error(`HYPERFRAMES_CMD 指向的命令不可用: ${cmd}。当前配置: ${raw}`);
    }
    return cmd;
  }

  const abs = path.isAbsolute(cmd) ? cmd : path.resolve(process.cwd(), cmd);
  if (!fs.existsSync(abs)) {
    throw new Error(`HYPERFRAMES_CMD 指向的文件不存在: ${abs}。当前配置: ${raw}`);
  }
  return abs;
}

function resolveLocalHyperframesCommand(): CommandSpec {
  if (!fs.existsSync(HF_PACKAGE_JSON)) {
    throw new Error("未安装 HyperFrames 本地依赖。请先运行 npm install，确保 package.json 中包含 hyperframes。");
  }

  let binRel = "dist/cli.js";
  try {
    const pkg = JSON.parse(fs.readFileSync(HF_PACKAGE_JSON, "utf-8"));
    const bin = pkg?.bin;
    if (typeof bin === "string") binRel = bin;
    else if (typeof bin?.hyperframes === "string") binRel = bin.hyperframes;
  } catch {}

  const cliPath = path.resolve(HF_PACKAGE_DIR, binRel);
  if (!fs.existsSync(cliPath)) {
    throw new Error(`HyperFrames CLI 缺失: ${cliPath}。请重新运行 npm install。`);
  }
  return {
    cmd: process.execPath,
    args: [cliPath],
    display: `${process.execPath} ${cliPath}`,
  };
}

function resolveHyperframesCommand(): CommandSpec {
  const raw = process.env.HYPERFRAMES_CMD?.trim();
  if (!raw) return resolveLocalHyperframesCommand();

  const toks = splitCommand(raw);
  if (!toks.length) throw new Error("HYPERFRAMES_CMD 为空，无法启动 HyperFrames。");
  return {
    cmd: normalizeConfiguredCommand(toks[0], raw),
    args: toks.slice(1),
    display: raw,
  };
}

// 文本→PNG 的 Python 助手（Pillow），生成透明标题/声明图，再由 ffmpeg overlay 叠加
const TEXT_RENDER_PY = path.resolve(process.cwd(), "workers/text_render/render_text.py");

// Pillow 可加载且含中文字形的字体，跨平台候选（macOS / Linux-WSL2）。
// 注：macOS PingFang.ttc Pillow 打不开，已排除。可用 SUBTITLE_FONT 环境变量显式指定。
const CJK_FONTS = [
  // macOS
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "/Library/Fonts/Arial Unicode.ttf",
  "/System/Library/Fonts/STHeiti Light.ttc",
  // Linux / WSL2（Noto / 文泉驿 / 思源黑体，需 apt 安装 fonts-noto-cjk 等）
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
  "/usr/share/fonts/truetype/arphic/uming.ttc",
  // 思源/Source Han 常见安装路径
  "/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Regular.otf",
];
function findFont(): string {
  const env = process.env.SUBTITLE_FONT?.trim();
  if (env && fs.existsSync(env)) return env;
  const found = CJK_FONTS.find((f) => fs.existsSync(f));
  if (found) return found;
  throw new Error(
    "未找到可用中文字体。Linux/WSL2 请安装：sudo apt install fonts-noto-cjk，" +
    "或用 SUBTITLE_FONT 环境变量指定一个 Pillow 可加载的 .ttf/.ttc/.otf 路径。"
  );
}

async function probeDuration(file: string): Promise<number> {
  try {
    const { stdout } = await execFileP(FFPROBE_BIN, [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", file,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : 0;
  } catch { return 0; }
}

type Cue = { start: number; end: number; text: string };
type RenderStyle = "clean" | "black" | "card" | "book" | "showcase" | "notes" | "quote" | "chapters" | "desk";
type RenderMotion = "cinematic" | "quick" | "calm" | "collage";
type RenderVariant = {
  style: RenderStyle;
  motion: RenderMotion;
  index: number;
  filename: string;
  label: string;
  statement: string;
  configured: boolean;
};

const MAX_RENDER_VARIANTS = 6;
const DEFAULT_STATEMENT_TEMPLATE = "本视频基于{author}《{title}》及相关研究资料整理\n仅用于健康科普分享，不构成任何建议或行为指导。";

const STYLE_LABELS: Record<RenderStyle, string> = {
  clean: "清醒语录",
  black: "黑底打字机",
  card: "暗色知识卡片",
  book: "图书口播卡片",
  showcase: "图书封面橱窗",
  notes: "划重点笔记",
  quote: "金句冲击卡",
  chapters: "章节进度条",
  desk: "书桌电影感",
};

const MOTION_LABELS: Record<RenderMotion, string> = {
  cinematic: "电影感",
  quick: "动感快剪",
  calm: "静帧放大",
  collage: "胶片复古",
};

const STYLE_VISUALS: Record<RenderStyle, {
  titleFill: number[];
  titleStroke: number[];
  subFill: number[];
  subStroke: number[];
  titleSize: number;
  subSize: number;
  titleY: number;
  subY: number;
  statementY: number;
  filter: string;
}> = {
  clean: {
    titleFill: [255, 247, 239, 255], titleStroke: [160, 57, 42, 230],
    subFill: [255, 255, 255, 255], subStroke: [0, 0, 0, 220],
    titleSize: 58, subSize: 52, titleY: 96, subY: 1500, statementY: 1660,
    filter: "eq=brightness=0.03:contrast=1.0:saturation=1.04",
  },
  black: {
    titleFill: [255, 255, 255, 255], titleStroke: [0, 0, 0, 255],
    subFill: [245, 245, 245, 255], subStroke: [0, 0, 0, 245],
    titleSize: 54, subSize: 54, titleY: 118, subY: 1460, statementY: 1660,
    filter: "eq=brightness=-0.04:contrast=1.12:saturation=0.78",
  },
  card: {
    titleFill: [226, 241, 248, 255], titleStroke: [18, 31, 42, 245],
    subFill: [255, 255, 255, 255], subStroke: [15, 28, 36, 245],
    titleSize: 56, subSize: 48, titleY: 88, subY: 1360, statementY: 1620,
    filter: "eq=brightness=-0.03:contrast=1.08:saturation=0.9",
  },
  book: {
    titleFill: [245, 255, 252, 255], titleStroke: [0, 0, 0, 220],
    subFill: [255, 226, 46, 255], subStroke: [0, 0, 0, 255],
    titleSize: 86, subSize: 48, titleY: 150, subY: 1125, statementY: 1288,
    filter: "eq=brightness=0.03:contrast=1.0:saturation=1.04",
  },
  showcase: {
    titleFill: [255, 226, 46, 255], titleStroke: [0, 0, 0, 245],
    subFill: [255, 226, 46, 255], subStroke: [0, 0, 0, 255],
    titleSize: 78, subSize: 50, titleY: 112, subY: 1265, statementY: 1608,
    filter: "eq=brightness=0.02:contrast=1.04:saturation=1.08",
  },
  notes: {
    titleFill: [38, 33, 26, 255], titleStroke: [255, 246, 222, 230],
    subFill: [35, 31, 24, 255], subStroke: [255, 250, 238, 255],
    titleSize: 62, subSize: 46, titleY: 124, subY: 1278, statementY: 1620,
    filter: "eq=brightness=0.04:contrast=0.98:saturation=0.92",
  },
  quote: {
    titleFill: [245, 245, 245, 255], titleStroke: [0, 0, 0, 220],
    subFill: [255, 255, 255, 255], subStroke: [0, 0, 0, 255],
    titleSize: 50, subSize: 58, titleY: 132, subY: 1450, statementY: 1660,
    filter: "eq=brightness=-0.035:contrast=1.12:saturation=0.86",
  },
  chapters: {
    titleFill: [229, 246, 242, 255], titleStroke: [5, 19, 22, 240],
    subFill: [255, 255, 255, 255], subStroke: [0, 0, 0, 245],
    titleSize: 58, subSize: 48, titleY: 174, subY: 1285, statementY: 1448,
    filter: "eq=brightness=-0.015:contrast=1.05:saturation=0.95",
  },
  desk: {
    titleFill: [255, 248, 232, 255], titleStroke: [0, 0, 0, 220],
    subFill: [255, 255, 255, 255], subStroke: [0, 0, 0, 238],
    titleSize: 56, subSize: 48, titleY: 130, subY: 1398, statementY: 1640,
    filter: "eq=brightness=0.018:contrast=1.02:saturation=0.98",
  },
};

const MOTION_LAYOUT_OFFSETS: Record<RenderMotion, { titleY: number; subY: number; statementY: number }> = {
  cinematic: { titleY: 0, subY: 0, statementY: 0 },
  quick: { titleY: -24, subY: 44, statementY: 10 },
  calm: { titleY: 24, subY: -72, statementY: -24 },
  collage: { titleY: 12, subY: 26, statementY: 4 },
};

const BOOK_MOTION_LAYOUT_OFFSETS: Record<RenderMotion, { titleY: number; subY: number; statementY: number }> = {
  cinematic: { titleY: 0, subY: 0, statementY: 0 },
  quick: { titleY: -42, subY: -44, statementY: 0 },
  calm: { titleY: 32, subY: 58, statementY: 14 },
  collage: { titleY: -6, subY: -22, statementY: 0 },
};

const BOOK_CARD_FRAME = {
  y: 520,
  h: 720,
  authorY: 335,
};

type MediaFrame = { y: number; h: number; authorY?: number };

function mediaFrameForStyle(style: RenderStyle): MediaFrame | null {
  if (style === "book") return BOOK_CARD_FRAME;
  if (style === "showcase") return { y: 548, h: 670 };
  if (style === "notes") return { y: 424, h: 590 };
  if (style === "chapters") return { y: 520, h: 640 };
  return null;
}

function slideshowOptionsForStyle(style: RenderStyle): SlideshowOptions {
  const frame = mediaFrameForStyle(style);
  return frame ? { width: 1080, height: frame.h, fit: "cover" } : FULL_FRAME_SLIDESHOW;
}

type SlideshowFit = "cover" | "contain" | "contain-blur";
type SlideshowOptions = {
  width: number;
  height: number;
  fit: SlideshowFit;
  padColor?: string;
};

type TimedSlide = {
  path: string;
  start: number;
  end: number;
  duration: number;
  sourceIndex: number;
  segmentStart: number;
  segmentEnd: number;
};

type ChapterMarker = {
  index: number;
  start: number;
  end: number;
  title: string;
  progress: number;
};

const FULL_FRAME_SLIDESHOW: SlideshowOptions = { width: 1080, height: 1920, fit: "cover" };
const BOOK_FRAME_SLIDESHOW: SlideshowOptions = {
  width: 1080,
  height: BOOK_CARD_FRAME.h,
  fit: "cover",
};

const MOTION_BG_FILTERS: Record<RenderMotion, string> = {
  cinematic: "scale=1166:2073,crop=1080:1920:x=(in_w-out_w)*(0.5+0.5*sin(t*0.18)):y=(in_h-out_h)*(0.5+0.5*cos(t*0.16)),eq=gamma=1.02",
  quick: "scale=1188:2112,crop=1080:1920:x=(in_w-out_w)*(0.5+0.5*sin(t*1.8)):y=(in_h-out_h)*(0.5+0.5*cos(t*1.4)),eq=contrast=1.08:saturation=1.12",
  calm: "scale=1140:2027,crop=1080:1920:x=(in_w-out_w)/2:y=(in_h-out_h)/2,eq=brightness=0.015:saturation=0.9",
  collage: "noise=alls=7:allf=t+u,eq=contrast=1.12:saturation=0.72:gamma=1.08",
};

// Generated still-image slides are already fitted to 1080x1920. Re-applying
// sinusoidal crop motion makes static illustrations look like they are shaking.
// Image-backed variants therefore use stable but visibly different template
// layers instead of moving crop windows.
const IMAGE_MOTION_TEMPLATES: Record<RenderMotion, { profile: string; filter: string }> = {
  cinematic: {
    profile: "cinematic-matte",
    filter: "eq=brightness=0.025:gamma=1.04:contrast=1.0:saturation=1.04",
  },
  quick: {
    profile: "quick-accent",
    filter: "unsharp=5:5:0.55:3:3:0,eq=brightness=0.02:contrast=1.06:saturation=1.12",
  },
  calm: {
    profile: "calm-soft",
    filter: "eq=brightness=0.02:contrast=0.96:saturation=0.86",
  },
  collage: {
    profile: "retro-film",
    filter: "colorchannelmixer=.42:.72:.16:0:.32:.68:.14:0:.24:.48:.14:0,noise=alls=10:allf=t+u,vignette=angle=PI/4:mode=forward",
  },
};

const STYLE_BACKGROUND_COLORS: Record<RenderStyle, string[]> = {
  clean: ["#181115", "#22151a", "#16141f"],
  black: ["#070707", "#111119", "#05070f"],
  card: ["#111923", "#142330", "#101d22"],
  book: ["#151209", "#1d1807", "#0f1210"],
  showcase: ["#060606", "#120f08", "#070707"],
  notes: ["#F4EBD8", "#EFE1C8", "#F8F1DF"],
  quote: ["#121212", "#16120f", "#0d0f10"],
  chapters: ["#0f181d", "#111f25", "#0c1518"],
  desk: ["#181511", "#211a12", "#151613"],
};

function variantOffset(variant: RenderVariant) {
  return (Math.max(1, variant.index) - 1) % 3;
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function indexedFill(fill: number[], offset: number) {
  if (!offset) return fill;
  const warm = offset === 1 ? 18 : -10;
  return [
    clampChannel(fill[0] + warm),
    clampChannel(fill[1] + (offset === 1 ? 8 : -8)),
    clampChannel(fill[2] + (offset === 1 ? -14 : 18)),
    fill[3] ?? 255,
  ];
}

function backgroundColorForVariant(variant: RenderVariant) {
  const colors = STYLE_BACKGROUND_COLORS[variant.style];
  return colors[variantOffset(variant)] || colors[0];
}

function variantFilter(variant: RenderVariant) {
  const offset = variantOffset(variant);
  if (offset === 1) return "eq=brightness=0.018:contrast=1.04:saturation=0.96";
  if (offset === 2) return "eq=brightness=-0.012:contrast=1.08:saturation=1.06";
  return "";
}

function parseMeta(raw: string | null | undefined) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function readConfigValue(arts: ReturnType<typeof getArtifacts>, key: string) {
  for (const a of arts) {
    if (a.stepName !== "config" || a.kind !== "json" || !a.meta) continue;
    const meta = parseMeta(a.meta);
    if ((meta as any).key === key) return (meta as any).value || null;
  }
  return null;
}

function clampCount(value: unknown) {
  const n = Math.floor(Number(value || 0));
  return Number.isFinite(n) ? Math.max(0, Math.min(9, n)) : 0;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function renderConfigValue(arts: ReturnType<typeof getArtifacts>): Record<string, unknown> {
  return objectValue(readConfigValue(arts, "render"));
}

function selectedMotionsFromConfig(value: unknown): RenderMotion[] {
  if (Array.isArray(value)) {
    return value.filter((motion): motion is RenderMotion => motion in MOTION_LABELS);
  }
  const motionConfig = objectValue(value);
  return (Object.keys(MOTION_LABELS) as RenderMotion[]).filter((motion) => !!motionConfig[motion]);
}

function buildRenderVariants(arts: ReturnType<typeof getArtifacts>): RenderVariant[] {
  const rawConfig = readConfigValue(arts, "render");
  if (!rawConfig || typeof rawConfig !== "object") {
    return [{
      style: "chapters", motion: "quick", index: 1, filename: "final_chapters_quick_1.mp4",
      label: "章节进度条 · 动感快剪 #1", statement: DEFAULT_STATEMENT_TEMPLATE, configured: false,
    }];
  }

  const renderConfig = objectValue(rawConfig);
  const counts = objectValue(renderConfig.styleCounts ?? renderConfig.styles);
  const motions = selectedMotionsFromConfig(renderConfig.motionPresets ?? renderConfig.motions);
  const selectedMotions = motions.length ? motions : ["quick" as RenderMotion];
  const statement = typeof renderConfig.statement === "string" && renderConfig.statement.trim()
    ? renderConfig.statement
    : DEFAULT_STATEMENT_TEMPLATE;
  const variants: RenderVariant[] = [];

  for (const style of Object.keys(STYLE_LABELS) as RenderStyle[]) {
    const count = clampCount(counts[style]);
    for (let i = 1; i <= count; i++) {
      for (const motion of selectedMotions) {
        variants.push({
          style, motion, index: i,
          filename: `final_${style}_${motion}_${i}.mp4`,
          label: `${STYLE_LABELS[style]} · ${MOTION_LABELS[motion]} #${i}`,
          statement, configured: true,
        });
      }
    }
  }

  return variants.length ? variants.slice(0, MAX_RENDER_VARIANTS) : [{
    style: "chapters", motion: "quick", index: 1, filename: "final_chapters_quick_1.mp4",
    label: "章节进度条 · 动感快剪 #1", statement, configured: true,
  }];
}

function fillStatement(template: string, task: any, book: any) {
  return template
    .replaceAll("{author}", task.bookAuthor || book.book_author || task.author || "作者")
    .replaceAll("{title}", task.bookTitle || book.book_title || task.title || "书名")
    .trim();
}

function cleanBookTitle(value: unknown) {
  return String(value || "").replace(/[《》]/g, "").trim();
}

function firstMeaningfulCue(cues: Cue[]) {
  return (cues.find((cue) => String(cue.text || "").trim().length >= 6)?.text || "").trim();
}

function compactLine(text: string, max = 18) {
  const clean = String(text || "")
    .replace(/\s+/g, "")
    .replace(/[，。！？!?；;：:、]+$/g, "");
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function chapterCountForDuration(dur: number) {
  if (dur >= 900) return 6;
  if (dur >= 480) return 5;
  if (dur >= 110) return 4;
  return 3;
}

function chapterCueText(cues: Cue[], at: number) {
  const cue = cues.find((item) => item.start >= at && String(item.text || "").trim().length >= 6)
    || cues.find((item) => item.end >= at && String(item.text || "").trim().length >= 6)
    || cues.find((item) => String(item.text || "").trim().length >= 6);
  return compactLine(cue?.text || "", 13);
}

function buildChapterMarkers(cues: Cue[], dur: number): ChapterMarker[] {
  const count = chapterCountForDuration(dur);
  return Array.from({ length: count }, (_, i) => {
    const start = +(dur * i / count).toFixed(3);
    const end = +(i === count - 1 ? dur : dur * (i + 1) / count).toFixed(3);
    const summary = chapterCueText(cues, start);
    return {
      index: i + 1,
      start,
      end,
      title: summary ? `第 ${i + 1} 个重点\n${summary}` : `第 ${i + 1} 个重点`,
      progress: (i + 1) / count,
    };
  });
}

function highlightTermsFor(task: any, book: any) {
  const terms = [
    cleanBookTitle(task.bookTitle || book.book_title),
    String(task.bookAuthor || book.book_author || "").replace(/^\[[^\]]+\]/, "").trim(),
    ...String(task.title || "")
      .split(/[#＃\s《》,，。！？!?:：|/\\]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2 && part.length <= 8),
  ];
  return Array.from(new Set(terms.filter(Boolean))).slice(0, 12);
}

function hookTextForVariant(task: any, book: any, cues: Cue[]) {
  if ((book as any)?.__renderStyle === "chapters") return "";
  const bookTitle = cleanBookTitle(task.bookTitle || book.book_title);
  const firstCue = compactLine(firstMeaningfulCue(cues), 22);
  if (bookTitle && firstCue) return `${firstCue}\n《${bookTitle}》给出答案`;
  if (firstCue) return firstCue;
  if (bookTitle) return `这本《${bookTitle}》\n值得认真看一遍`;
  return "这段话\n值得你听完";
}

function ctaTextForVariant(task: any, book: any) {
  const bookTitle = cleanBookTitle(task.bookTitle || book.book_title);
  if (bookTitle) return `读《${bookTitle}》\n把关键方法收藏起来`;
  return "把这段内容收藏起来\n需要时再听一遍";
}

function prefersBookTitle(style: RenderStyle) {
  return ["book", "card", "showcase", "notes", "chapters", "desk"].includes(style);
}

function titleForVariant(variant: RenderVariant, task: any, book: any, fallback: string) {
  const bookTitle = task.bookTitle || book.book_title;
  if (variant.style === "chapters") return "";
  if (prefersBookTitle(variant.style) && bookTitle) return `《${cleanBookTitle(bookTitle)}》`;
  if (variant.style === "quote") return "这句话值得听完";
  return fallback;
}

function authorForVariant(variant: RenderVariant, task: any, book: any) {
  return "";
}

function statementForVariant(variant: RenderVariant, task: any, book: any) {
  return (variant.style === "card" || variant.style === "book" || variant.style === "showcase" || variant.style === "notes" || variant.style === "chapters" || variant.style === "desk")
    ? fillStatement(variant.statement, task, book)
    : "";
}

// 调 Pillow 批量渲染少量文本 PNG，返回每张 {out,w,h}
async function renderTexts(font: string, items: any[], dir: string): Promise<{ out: string; w: number; h: number }[]> {
  if (!items.length) return [];
  const cfgPath = path.join(dir, "_textcfg.json");
  fs.writeFileSync(cfgPath, JSON.stringify({ font, items }), "utf-8");
  const { stdout } = await execFileP("python3", [TEXT_RENDER_PY, cfgPath], {
    maxBuffer: 1024 * 1024 * 16,
  });
  try { fs.unlinkSync(cfgPath); } catch {}
  return JSON.parse(stdout);
}

function fileStem(filename: string) {
  return path.basename(filename, path.extname(filename)).replace(/[^a-z0-9_-]+/gi, "_") || "final";
}

function removeZeroByteFile(file: string) {
  try {
    if (fs.existsSync(file) && fs.statSync(file).size === 0) fs.unlinkSync(file);
  } catch {}
}

function promoteNonEmptyOutput(tmpPath: string, finalPath: string, label: string) {
  if (!fs.existsSync(tmpPath)) throw new Error(`${label} 未产出`);
  const size = fs.statSync(tmpPath).size;
  if (size <= 0) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw new Error(`${label} 是空文件`);
  }
  try { fs.unlinkSync(finalPath); } catch {}
  fs.renameSync(tmpPath, finalPath);
}

function twoHex(value: number) {
  return clampChannel(value).toString(16).padStart(2, "0").toUpperCase();
}

function assColor(rgba: number[]) {
  const r = rgba[0] ?? 255;
  const g = rgba[1] ?? 255;
  const b = rgba[2] ?? 255;
  const a = rgba[3] ?? 255;
  return `&H${twoHex(255 - a)}${twoHex(b)}${twoHex(g)}${twoHex(r)}`;
}

function assTime(sec: number) {
  const totalCs = Math.max(0, Math.round(sec * 100));
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assFontName(font: string) {
  const base = path.basename(font).toLowerCase();
  if (base.includes("hiragino")) return "Hiragino Sans GB";
  if (base.includes("stheiti")) return "STHeiti";
  if (base.includes("arial unicode")) return "Arial Unicode MS";
  if (base.includes("notosanscjk") || base.includes("noto")) return "Noto Sans CJK SC";
  if (base.includes("sourcehansans") || base.includes("source-han-sans")) return "Source Han Sans SC";
  if (base.includes("wqy-zenhei")) return "WenQuanYi Zen Hei";
  if (base.includes("wqy-microhei")) return "WenQuanYi Micro Hei";
  if (base.includes("uming")) return "AR PL UMing CN";
  return "sans-serif";
}

function escapeAssPlain(text: string) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assHighlightedText(text: string, highlightTerms: string[] = []) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const terms = highlightTerms
    .map((term) => String(term || "").trim())
    .filter((term) => term.length >= 2)
    .sort((a, b) => b.length - a.length);
  const numberPattern = `[零〇一二三四五六七八九十百千万两\\d]+(?:岁|年|个月|件事|个方法|个真相|%|％)?`;
  const pattern = [...terms.map(escapeRegExp), numberPattern].join("|");
  const re = pattern ? new RegExp(`(${pattern})`, "g") : null;
  return lines.map((line) => {
    if (!re) return escapeAssPlain(line);
    let out = "";
    let last = 0;
    line.replace(re, (match, _m, offset) => {
      out += escapeAssPlain(line.slice(last, offset));
      out += `{\\c&H002EE2FF&}` + escapeAssPlain(match) + `{\\rSubtitle}`;
      last = offset + match.length;
      return match;
    });
    out += escapeAssPlain(line.slice(last));
    return out;
  }).join("\\N");
}

function escapeFfmpegFilterValue(value: string) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function ffColor(hex: string, alpha = 1) {
  return `${hex}@${Math.max(0, Math.min(1, alpha)).toFixed(2)}`;
}

function boxLayer(input: string, out: string, x: number | string, y: number | string, w: number | string, h: number | string, color: string, t = "fill", enable?: string) {
  const enabled = enable ? `:enable='${enable}'` : "";
  return `[${input}]drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=${t}${enabled}[${out}];`;
}

function templatePreSubDecor(style: RenderStyle, input: string, dur: number, variant: RenderVariant) {
  let fc = "";
  let last = input;
  const next = (suffix: string) => `decor_${suffix}_${variant.style}_${variant.motion}_${variant.index}`.replace(/[^a-z0-9_]/gi, "_");
  if (style === "showcase") {
    let n = next("line1");
    fc += boxLayer(last, n, 86, 118, 908, 5, ffColor("#FFE135", .92));
    last = n;
    n = next("line2");
    fc += boxLayer(last, n, 86, 1228, 908, 5, ffColor("#FFE135", .82));
    last = n;
  } else if (style === "notes") {
    let n = next("margin");
    fc += boxLayer(last, n, 78, 1140, 8, 190, ffColor("#B44735", .95), "fill", "gte(t,3.45)");
    last = n;
    n = next("tag");
    fc += boxLayer(last, n, 82, 1060, 210, 58, ffColor("#B44735", .96), "fill", "gte(t,3.45)");
    last = n;
  } else if (style === "quote") {
    let n = next("shade");
    fc += boxLayer(last, n, 0, 0, "iw", "ih", ffColor("#000000", .34));
    last = n;
    n = next("accent");
    fc += boxLayer(last, n, 118, 1042, 844, 8, ffColor("#FFE135", .98));
    last = n;
  } else if (style === "chapters") {
    let n = next("track");
    fc += boxLayer(last, n, 86, 118, 908, 10, ffColor("#FFFFFF", .18));
    last = n;
  } else if (style === "desk") {
    let n = next("vignette");
    fc += `[${last}]vignette=angle=PI/5:mode=forward:eval=init[${n}];`;
    last = n;
    n = next("shade");
    fc += boxLayer(last, n, 0, 0, "iw", "ih", ffColor("#000000", .12));
    last = n;
  }
  return { fc, last };
}

function templatePostSubDecor(style: RenderStyle, input: string, variant: RenderVariant) {
  let fc = "";
  let last = input;
  const next = (suffix: string) => `post_${suffix}_${variant.style}_${variant.motion}_${variant.index}`.replace(/[^a-z0-9_]/gi, "_");
  if (style === "notes") {
    const n = next("note_card");
    fc += boxLayer(last, n, 70, 1150, 940, 214, ffColor("#FFF9EE", .86), "fill", "gte(t,3.45)");
    last = n;
  } else if (style === "chapters") {
    const n = next("cap_bg");
    fc += boxLayer(last, n, 72, 1210, 936, 196, ffColor("#000000", .46), "fill", "gte(t,3.45)");
    last = n;
  } else if (style === "showcase") {
    const n = next("cap_bg");
    fc += boxLayer(last, n, 74, 1232, 932, 214, ffColor("#000000", .54), "fill", "gte(t,3.45)");
    last = n;
  } else if (style === "desk") {
    const n = next("cap_bg");
    fc += boxLayer(last, n, 76, 1340, 928, 188, ffColor("#000000", .38), "fill", "gte(t,3.45)");
    last = n;
  }
  return { fc, last };
}

function writeAssSubtitles(opts: {
  cues: Cue[];
  dur: number;
  font: string;
  visual: typeof STYLE_VISUALS[RenderStyle];
  offset: number;
  subY: number;
  highlightTerms?: string[];
  suppressBefore?: number;
  out: string;
}) {
  const fill = indexedFill(opts.visual.subFill, opts.offset);
  const outline = opts.visual.subStroke;
  const fontName = assFontName(opts.font);
  const fontSize = opts.visual.subSize;
  const outlineSize = opts.visual === STYLE_VISUALS.clean ? 6 : 7;
  const marginV = Math.max(0, Math.round(opts.subY));
  const events = opts.cues
    .map((cue) => {
      const start = Math.max(Number(opts.suppressBefore || 0), Math.max(0, Number(cue.start) || 0));
      const end = Math.min(opts.dur, Math.max(start, Number(cue.end) || 0));
      const text = assHighlightedText(cue.text || "", opts.highlightTerms || []);
      return { start, end, text };
    })
    .filter((cue) => cue.text.trim().length > 0 && cue.start < cue.end)
    .map((cue) => `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Subtitle,,70,70,${marginV},,${cue.text}`);

  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 0",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Subtitle,${fontName},${fontSize},${assColor(fill)},${assColor(fill)},${assColor(outline)},&H80000000,0,0,0,0,100,100,0,0,1,${outlineSize},0,8,70,70,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
  fs.writeFileSync(opts.out, ass, "utf-8");
  return { path: opts.out, events: events.length };
}

function slideshowVideoFilter(opts: SlideshowOptions): string {
  if (opts.fit === "contain-blur") {
    return [
      "split=2[cover][fg]",
      [
        `[cover]scale=${opts.width}:${opts.height}:force_original_aspect_ratio=increase`,
        `crop=${opts.width}:${opts.height}`,
        "boxblur=24:1",
        "eq=brightness=-0.04:saturation=0.9[bg]",
      ].join(","),
      `[fg]scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease[fgfit]`,
      "[bg][fgfit]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=25",
    ].join(";");
  }
  if (opts.fit === "contain") {
    const padColor = opts.padColor || "black";
    return [
      `scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease`,
      `pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2:color=${padColor}`,
      "setsar=1",
      "fps=25",
    ].join(",");
  }
  return [
    `scale=${opts.width}:${opts.height}:force_original_aspect_ratio=increase`,
    `crop=${opts.width}:${opts.height}`,
    "setsar=1",
    "fps=25",
  ].join(",");
}

function slideshowCacheKey(opts: SlideshowOptions): string {
  return `${opts.width}x${opts.height}-${opts.fit}-${opts.padColor || "none"}`;
}

function isFramedStyle(style: RenderStyle) {
  return !!mediaFrameForStyle(style);
}

function sum(values: number[]) {
  return values.reduce((acc, value) => acc + value, 0);
}

function normalizedSegDurations(segDurs: number[], totalDur: number): number[] {
  const valid = segDurs
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0.01);
  if (!valid.length) return [];
  const total = sum(valid);
  if (total <= 0) return [];
  if (Math.abs(total - totalDur) <= 0.15) return valid;
  const scale = totalDur > 0 ? totalDur / total : 1;
  return valid.map((value) => value * scale);
}

function evenlySpacedIndices(total: number, count: number): number[] {
  if (count <= 0 || total <= 0) return [];
  if (count >= total) return Array.from({ length: total }, (_, index) => index);
  return Array.from({ length: count }, (_, index) => {
    const raw = Math.floor(index * total / count);
    return Math.max(0, Math.min(total - 1, raw));
  });
}

function buildTimedSlides(
  images: { path: string }[],
  segDurs: number[],
  totalDur: number,
  opts?: { minHoldSec?: number; maxSlides?: number },
): TimedSlide[] {
  if (!images.length || totalDur <= 0) return [];
  const normalizedSegs = normalizedSegDurations(segDurs, totalDur);
  const minHoldSec = Math.max(1.2, Number(opts?.minHoldSec || 0) || 0);

  if (!normalizedSegs.length) {
    const fallbackCount = Math.max(1, Math.min(
      images.length,
      Math.floor(Number.isFinite(opts?.maxSlides) ? Number(opts?.maxSlides) : images.length),
    ));
    const indices = evenlySpacedIndices(images.length, fallbackCount);
    const perSlide = totalDur / indices.length;
    let cursor = 0;
    return indices.map((sourceIndex, index) => {
      const end = index === indices.length - 1 ? totalDur : cursor + perSlide;
      const slide = {
        path: images[sourceIndex].path,
        start: +cursor.toFixed(3),
        end: +end.toFixed(3),
        duration: +(end - cursor).toFixed(3),
        sourceIndex,
        segmentStart: index,
        segmentEnd: index,
      };
      cursor = end;
      return slide;
    });
  }

  const holdLimitedSlides = minHoldSec > 0 ? Math.max(1, Math.ceil(totalDur / minHoldSec)) : normalizedSegs.length;
  const wantedSlides = Math.min(
    images.length,
    normalizedSegs.length,
    Math.max(1, Math.min(holdLimitedSlides, Number.isFinite(opts?.maxSlides) ? Number(opts?.maxSlides) : holdLimitedSlides)),
  );
  const imageIndices = evenlySpacedIndices(images.length, wantedSlides);
  const slides: TimedSlide[] = [];
  let cursor = 0;

  for (let i = 0; i < wantedSlides; i++) {
    const segmentStart = Math.floor(i * normalizedSegs.length / wantedSlides);
    const segmentEnd = Math.max(segmentStart, Math.floor((i + 1) * normalizedSegs.length / wantedSlides) - 1);
    const duration = sum(normalizedSegs.slice(segmentStart, segmentEnd + 1));
    const end = i === wantedSlides - 1 ? totalDur : Math.min(totalDur, cursor + duration);
    slides.push({
      path: images[imageIndices[i]].path,
      start: +cursor.toFixed(3),
      end: +end.toFixed(3),
      duration: +(end - cursor).toFixed(3),
      sourceIndex: imageIndices[i],
      segmentStart,
      segmentEnd,
    });
    cursor = end;
  }

  if (slides.length) {
    slides[slides.length - 1].end = +totalDur.toFixed(3);
    slides[slides.length - 1].duration = +(slides[slides.length - 1].end - slides[slides.length - 1].start).toFixed(3);
  }
  return slides.filter((slide) => slide.duration > 0.01);
}

// 用配图分镜 + 段落时长合成"轮播背景"视频（每张图按对应段落时长显示）
async function buildSlideshow(
  slides: TimedSlide[],
  totalDur: number,
  dir: string,
  prefix = "_slideshow",
  opts: SlideshowOptions = FULL_FRAME_SLIDESHOW,
): Promise<string | null> {
  if (!slides.length) return null;
  // concat demuxer 列表（最后一张需重复一行，否则末张时长被吞）
  const listLines: string[] = [];
  for (const slide of slides) {
    listLines.push(`file '${path.resolve(slide.path)}'`);
    listLines.push(`duration ${slide.duration.toFixed(3)}`);
  }
  listLines.push(`file '${path.resolve(slides[slides.length - 1].path)}'`);
  const listPath = path.join(dir, `${prefix}_slides.txt`);
  fs.writeFileSync(listPath, listLines.join("\n"), "utf-8");
  const out = path.join(dir, `${prefix}.mp4`);
  // 用绝对路径，不设 cwd（避免二次拼接）。
  await execFileP(FFMPEG_BIN, [
    "-y", "-nostdin", "-f", "concat", "-safe", "0", "-i", path.resolve(listPath),
    "-vf", slideshowVideoFilter(opts),
    "-c:v", "libx264", "-preset", RENDER_PRESET, "-crf", RENDER_CRF, "-pix_fmt", "yuv420p",
    "-t", String(totalDur), path.resolve(out),
  ], { maxBuffer: 1024 * 1024 * 64 });
  try { fs.unlinkSync(listPath); } catch {}
  return fs.existsSync(out) ? path.resolve(out) : null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shortHash(value: string) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

// 可被 Chrome @font-face 内嵌的 CJK 字体（ttf/otf/woff2；.ttc 不可靠故排除）。
// 优先 HYPERFRAMES_FONT 显式指定，其次探测常见单文件 CJK 字体。
const HF_EMBED_FONTS = [
  // macOS（Arial Unicode 含全 CJK，单 ttf 可内嵌）
  "/Library/Fonts/Arial Unicode.ttf",
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  // Linux/WSL2 思源/Noto 单文件 otf（apt fonts-noto-cjk 后常见）
  "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
  "/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Regular.otf",
];

/**
 * 生成 @font-face 块：把一份 CJK 字体 base64 内嵌进 HTML，使成片在 Docker/远端
 * 渲染（无系统中文字体）时也能正确显示中文。本机渲染有系统字体可不内嵌（省体积）。
 * 仅当字体可读且为 ttf/otf/woff2 时内嵌；否则返回空串降级到 font-family 系统字体。
 */
function buildFontFace(): string {
  const env = process.env.HYPERFRAMES_FONT?.trim();
  const candidates = env ? [env, ...HF_EMBED_FONTS] : HF_EMBED_FONTS;
  const file = candidates.find((f) => f && fs.existsSync(f) && /\.(ttf|otf|woff2?)$/i.test(f));
  if (!file) return ""; // 无可内嵌字体：降级系统字体（本机 Chrome 有中文即可）
  try {
    const stat = fs.statSync(file);
    // 字体过大内嵌会让 HTML 爆大且 hyperframes 子集化慢；上限默认 30MB
    // （Arial Unicode 全 CJK 约 23MB，需放行；50MB 的 .ttc 仍会被挡）。
    if (stat.size > Number(process.env.HYPERFRAMES_FONT_MAX_BYTES || 30 * 1024 * 1024)) return "";
    const cacheKey = `${file}:${stat.size}:${stat.mtimeMs}`;
    const cached = hfFontFaceCache.get(cacheKey);
    if (cached != null) return cached;
    const ext = file.toLowerCase().match(/\.(ttf|otf|woff2?)$/)?.[1] || "ttf";
    const fmt = ext === "otf" ? "opentype" : ext === "woff2" ? "woff2" : ext === "woff" ? "woff" : "truetype";
    const b64 = fs.readFileSync(file).toString("base64");
    const css = `@font-face{font-family:"HF CJK";src:url(data:font/${ext};base64,${b64}) format("${fmt}");font-display:block;}`;
    hfFontFaceCache.set(cacheKey, css);
    return css;
  } catch { return ""; }
}

async function preparedHyperframesVideoBackground(videoAbs: string, dir: string): Promise<string> {
  const fpsNum = Number(process.env.HYPERFRAMES_FPS || 30) || 30;
  let stat: fs.Stats | null = null;
  try { stat = fs.statSync(videoAbs); } catch {}
  const ext = path.extname(videoAbs) || ".mp4";
  const cacheKey = shortHash(`${path.resolve(videoAbs)}:${stat?.size || 0}:${stat?.mtimeMs || 0}:fps=${fpsNum}`);
  const cached = path.join(dir, `_hf_bg_${cacheKey}.mp4`);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 1024) return cached;
  const tmp = path.join(dir, `._hf_bg_${cacheKey}.${process.pid}.tmp.mp4`);
  try { fs.unlinkSync(tmp); } catch {}
  await execFileP(FFMPEG_BIN, [
    "-y", "-i", path.resolve(videoAbs), "-an",
    "-c:v", "libx264", "-r", String(fpsNum),
    "-g", String(fpsNum), "-keyint_min", String(fpsNum),
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    path.resolve(tmp),
  ], { maxBuffer: 1024 * 1024 * 64, timeout: Number(process.env.HYPERFRAMES_BG_TIMEOUT_MS || 300000) });
  promoteNonEmptyOutput(tmp, cached, "HyperFrames 背景缓存");
  return cached;
}

/**
 * 用 HyperFrames（HTML timeline）渲染成片（参考文章首选方案）。
 * 复制 lib/hyperframes/template/index.html 到任务目录 → 注入路径/字幕/标题 →
 * 调 `hyperframes render composition.html -o final.mp4`。
 * 背景层默认使用生成图片时间轴；没有图片时才用原视频静音 cover 9:16。
 * 独立 <audio> 走 TTS，字幕层按 cues 时间轴逐句显隐。
 * 成功返回 final.mp4 绝对路径；任何失败抛错（由 runRender 回退到 ffmpeg）。
 */
async function renderWithHyperframes(
  opts: {
    dir: string;
    videoAbs: string | null;
    images?: { path: string }[];
    audioAbs: string;
    cues: Cue[];
    dur: number;
    segDurs?: number[];
    title: string;
    hookText?: string;
    ctaText?: string;
    highlightTerms?: string[];
    variant?: RenderVariant;
    statementText?: string;
  },
): Promise<string> {
  const { dir, videoAbs, audioAbs, cues, dur, title } = opts;
  const hfImages = (opts.images || []).filter((img) => img.path && fs.existsSync(img.path));
  const variant = opts.variant || {
    style: "clean" as RenderStyle,
    motion: "cinematic" as RenderMotion,
    index: 1,
    filename: "final.mp4",
    label: "成片 final.mp4",
    statement: "",
    configured: false,
  };
  const statementText = (opts.statementText || "").trim();
  if (!hfImages.length && !videoAbs) throw new Error("HyperFrames 路径需要生成图片或原视频做背景层");
  if (!fs.existsSync(HF_TEMPLATE)) throw new Error("缺少 HyperFrames 模板: " + HF_TEMPLATE);
  const hfCommand = resolveHyperframesCommand();

  const stem = fileStem(variant.filename);
  const workDir = path.join(dir, `.hyperframes_${stem}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  const audioName = path.basename(audioAbs);
  fs.copyFileSync(audioAbs, path.join(workDir, audioName));

  // composition.html 与素材同在干净工作目录，用相对文件名引用，避免任务根目录旧 HTML 被 HyperFrames 当成第二入口。
  const tpl = fs.readFileSync(HF_TEMPLATE, "utf-8");
  const durStr = dur.toFixed(3);

  // 标题层（常驻整片）：data 驱动的 .clip，无需 JS
  const titleLayer = title
    ? `<div id="hf-title" class="title-card title-${variant.style} clip" data-start="0" data-duration="${durStr}" data-track-index="2">${escapeHtml(title)}</div>`
    : "";
  const hookLayer = opts.hookText
    ? `<div id="hf-hook" class="hook-card clip" data-start="0" data-duration="${Math.min(3.4, dur).toFixed(3)}" data-track-index="4">${escapeHtml(opts.hookText)}</div>`
    : "";
  const statementLayer = statementText
    ? `<div id="hf-statement" class="statement-card clip" data-start="0" data-duration="${durStr}" data-track-index="3">${escapeHtml(statementText)}</div>`
    : "";
  const ctaLayer = opts.ctaText && dur > 4.5
    ? `<div id="hf-cta" class="cta-card clip" data-start="${Math.max(0, dur - 4.2).toFixed(3)}" data-duration="4.2" data-track-index="5">${escapeHtml(opts.ctaText)}</div>`
    : "";

  // 字幕层改为注入 cues JSON，由模板内离线 timeline 控制逐句显隐。
  // 关键：HyperFrames 要求每个 data-composition-id 在 window.__timelines 注册一条
  // paused timeline，否则渲染器等待 45s 超时（曾因此整片失败）。
  // 用 JSON 注入避免在 HTML 里手拼大量 DOM；裁掉超出时长的 cue。
  const safeCues = cues
    .map((c) => ({
      start: Math.max(0, Number(c.start) || 0),
      end: Math.min(dur, Math.max(Number(c.start) || 0, Number(c.end) || 0)),
      text: String(c.text ?? ""),
    }))
    .filter((c) => c.text.trim().length > 0 && c.start < dur);
  // 内联进 <script type="application/json">，须转义 < 防止提前闭合 </script>
  const cuesJson = JSON.stringify(safeCues).replace(/</g, "\\u003c");
  const highlightTermsJson = JSON.stringify(opts.highlightTerms || []).replace(/</g, "\\u003c");

  let bgName = "";
  let backgroundMarkup = "";
  let backgroundJson = "[]";
  let backgroundType = "video";
  if (hfImages.length) {
    backgroundType = "images";
    const minHold = Math.max(1.2, Number(process.env.RENDER_IMAGE_MIN_HOLD_SEC || process.env.HYPERFRAMES_IMAGE_MIN_HOLD_SEC || 5.5));
    const timeline = buildTimedSlides(hfImages, opts.segDurs || [], dur, { minHoldSec: minHold });
    const slides = timeline.map((slide, i) => {
      const name = `hf_slide_${String(i + 1).padStart(3, "0")}${path.extname(slide.path) || ".jpg"}`;
      fs.copyFileSync(path.resolve(slide.path), path.join(workDir, name));
      return {
        src: name,
        start: slide.start,
        end: slide.end,
        sourceIndex: slide.sourceIndex,
        segmentStart: slide.segmentStart,
        segmentEnd: slide.segmentEnd,
      };
    });
    backgroundJson = JSON.stringify(slides).replace(/</g, "\\u003c");
    backgroundMarkup = '<div id="image-roll" aria-hidden="true"></div>';
  } else {
    // 背景视频关键帧加密：原抖音视频关键帧间隔可达 8s+，HyperFrames 逐帧 seek 捕帧时
    // 会"seek 失败/画面冻结"（lint 也会告警）。先重编码成每 1s 一个关键帧（GOP=fps）的
    // hf_bg.mp4 供合成用，避免背景卡顿。失败则回退原视频（至少能出片）。
    const sourceExt = path.extname(videoAbs!) || ".mp4";
    const sourceCopyName = `hf_source${sourceExt}`;
    fs.copyFileSync(path.resolve(videoAbs!), path.join(workDir, sourceCopyName));
    bgName = sourceCopyName;
    try {
      const bgAbs = await preparedHyperframesVideoBackground(videoAbs!, dir);
      bgName = `hf_bg${path.extname(bgAbs) || ".mp4"}`;
      fs.copyFileSync(bgAbs, path.join(workDir, bgName));
    } catch (e: any) {
      console.warn("[render] 背景关键帧加密失败，回退原视频（背景可能 seek 卡顿）：", String(e?.message || e));
    }
    backgroundMarkup = `<video
        id="a-roll" class="clip"
        src="${escapeHtml(bgName)}"
        muted playsinline
        data-start="0" data-duration="${durStr}" data-track-index="0"
        data-has-audio="false"
      ></video>`;
  }

  const html = tpl
    .replaceAll("__VIDEO_DURATION__", durStr)
    .replace("__FONT_FACE__", buildFontFace())
    .replace("__BACKGROUND_MARKUP__", backgroundMarkup)
    .replace("__BACKGROUND_JSON__", backgroundJson)
    .replace("__BACKGROUND_TYPE__", backgroundType)
    .replace("__AUDIO_SRC__", audioName)
    .replace("__BOOK_FRAME_Y__", String(BOOK_CARD_FRAME.y))
    .replace("__BOOK_FRAME_H__", String(BOOK_CARD_FRAME.h))
    .replace("__BOOK_AUTHOR_Y__", String(BOOK_CARD_FRAME.authorY))
    .replaceAll("__STYLE__", variant.style)
    .replaceAll("__MOTION__", variant.motion)
    .replaceAll("__VARIANT_INDEX__", String(variant.index))
    .replace("__TITLE_LAYER__", titleLayer)
    .replace("__HOOK_LAYER__", hookLayer)
    .replace("__STATEMENT_LAYER__", statementLayer)
    .replace("__CTA_LAYER__", ctaLayer)
    .replace("__HIGHLIGHT_TERMS__", highlightTermsJson)
    .replace("__CUES_JSON__", cuesJson);
  // CLI 渲染「项目目录」的 index.html，故写成 index.html（与 source.mp4/tts.wav 同级）
  const compPath = path.join(workDir, "index.html");
  fs.writeFileSync(compPath, html, "utf-8");

  const fps = (process.env.HYPERFRAMES_FPS || "30").trim();
  const quality = (process.env.HYPERFRAMES_QUALITY || "high").trim();
  const outAbs = path.join(dir, variant.filename);
  const tmpOutAbs = path.join(workDir, `.${stem}.hyperframes.${process.pid}.tmp.mp4`);
  removeZeroByteFile(outAbs);
  try { fs.unlinkSync(tmpOutAbs); } catch {}
  const args = [
    ...hfCommand.args,
    "render", path.resolve(workDir),
    "-o", path.resolve(tmpOutAbs),
    "-f", fps, "-q", quality,
  ];
  try {
    await execFileP(hfCommand.cmd, args, {
      cwd: dir,
      maxBuffer: 1024 * 1024 * 256,
      // Chromium 首次拉取 + 渲染可能较久
      timeout: Number(process.env.HYPERFRAMES_TIMEOUT_MS || 600000),
      env: { ...process.env },
    });
  } catch (e: any) {
    const stdout = String(e?.stdout || "");
    const stderr = String(e?.stderr || "");
    const full = [stdout, stderr, String(e?.message || e)].filter(Boolean).join("\n");
    try { fs.unlinkSync(tmpOutAbs); } catch {}
    try {
      fs.writeFileSync(
        path.join(dir, "_hyperframes_err.log"),
        "CMD: " + hfCommand.display + "\nARGS:\n" + JSON.stringify(args, null, 2) +
          "\n\nSTDOUT:\n" + stdout + "\n\nSTDERR:\n" + stderr + "\n\nERROR:\n" + String(e?.message || e),
      );
    } catch {}
    throw new Error("hyperframes 渲染失败: " + full.slice(-600));
  }
  promoteNonEmptyOutput(tmpOutAbs, outAbs, "hyperframes final.mp4");
  try { fs.unlinkSync(path.join(dir, "_hyperframes_err.log")); } catch {}
  return path.resolve(outAbs);
}

export async function runRender(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  clearArtifacts(taskId, "render");

  const arts = getArtifacts(taskId);
  const audio = arts.find((a) => a.stepName === "tts" && a.kind === "audio");
  const cuesArt = arts.find((a) => a.stepName === "subtitle" && a.kind === "cues");
  const video = arts.find((a) => a.stepName === "extract" && a.kind === "video");
  const images = arts
    .filter((a) => a.stepName === "images" && a.kind === "image" && a.path)
    .sort((a, b) => {
      const ai = a.meta ? (JSON.parse(a.meta).idx ?? 0) : 0;
      const bi = b.meta ? (JSON.parse(b.meta).idx ?? 0) : 0;
      return ai - bi;
    })
    .map((a) => ({ ...a, path: a.path! }));
  const usableImages = images.filter((a) => fs.existsSync(path.resolve(a.path)));
  const videoCover = arts
    .filter((a) => a.stepName === "images" && a.kind === "video_cover" && a.path)
    .sort((a, b) => b.createdAt - a.createdAt)
    .find((a) => fs.existsSync(path.resolve(a.path!)));
  const renderImages = videoCover?.path
    ? [{ ...videoCover, path: videoCover.path }, ...usableImages]
    : usableImages;
  if (!audio?.path) throw new Error("缺少 TTS 音频");
  if (!cuesArt?.path) throw new Error("缺少字幕时间轴 cues.json");

  const dir = taskDir(taskId);
  const audioAbs = path.resolve(audio.path);
  const cues: Cue[] = JSON.parse(fs.readFileSync(path.resolve(cuesArt.path), "utf-8"));
  const audioMeta = audio.meta ? JSON.parse(audio.meta) : {};
  const dur = audioMeta.totalDur || (await probeDuration(audioAbs));
  const segDurs: number[] = (audioMeta.segments || []).map((s: any) => s.dur || 0);
  const titleText = (task.title || "").replace(/[#＃].*$/, "").slice(0, 20).trim();
  const bookMeta = parseMeta(arts.find((a) => a.stepName === "rewrite" && a.kind === "json")?.meta);
  const renderConfig = renderConfigValue(arts);
  const variants = buildRenderVariants(arts);
  const highlightTerms = highlightTermsFor(task, bookMeta);

  // 渲染引擎：任务配置 render.engine 优先，其次 RENDER_ENGINE。
  //   hyperframes → 使用 HyperFrames；失败直接暴露，避免网页显示成功但实际回退。
  //   auto → 短视频先试 HyperFrames，长视频/失败时回退 ffmpeg。
  //   ffmpeg → 直接走纯 ffmpeg（不依赖 Chromium/网络，V1 兜底）
  const configuredEngine = typeof renderConfig.engine === "string" ? renderConfig.engine.trim().toLowerCase() : "";
  const rawEngine = (configuredEngine || process.env.RENDER_ENGINE || "auto").trim().toLowerCase();
  const engine = rawEngine === "ffmpeg" || rawEngine === "auto" ? rawEngine : "hyperframes";

  // 背景模式：任务配置 render.background 优先，其次 RENDER_BG。
  // HyperFrames 当前生产模板支持生成图片时间轴；没有图片时才用原视频背景。
  const configuredBg = typeof renderConfig.background === "string" ? renderConfig.background.trim().toLowerCase() : "";
  const envBg = process.env.RENDER_BG?.trim().toLowerCase() || "";
  const rawBgMode = engine === "hyperframes" && renderImages.length > 0 && envBg !== "video"
    ? "images"
    : (configuredBg || envBg || (engine === "hyperframes" ? "images" : "auto")).trim().toLowerCase();
  const bgMode = rawBgMode === "images" || rawBgMode === "auto" ? rawBgMode : "video";
  let useImages = false;
  if (bgMode === "images") useImages = renderImages.length > 0;
  else if (bgMode === "auto") useImages = renderImages.length > 0;
  // bgMode === "video" → 始终用原视频

  setStepStatus(taskId, "render", { progress: 0.1 });

  const videoAbs = video?.path ? path.resolve(video.path) : null;

  // ===== 首选：HyperFrames（HTML timeline）渲染（参考文章方案）=====
  // 有生成图片时，HyperFrames 直接用图片时间轴；没有图片则回退到原视频背景。
  // 性能：HyperFrames 用 Chrome 逐帧截图(~3fps 捕获)，时长越长越慢——264s 视频约需 ~40min，
  // 而 ffmpeg 叠层仅 ~3s。故 auto 模式对超过阈值的长视频自动走 ffmpeg（仅显式 hyperframes 才硬上）。
  // 阈值 RENDER_HF_MAX_SEC 默认 30s（短视频用 HTML 动效更精致，长视频用 ffmpeg 保速度）。
  const hfMaxSec = Number(process.env.RENDER_HF_MAX_SEC || 30);
  const forceLongHyperframes = process.env.RENDER_ENGINE_FORCE === "1";
  const tooLongForHF = dur > hfMaxSec && !forceLongHyperframes;
  const wantHF = (engine === "hyperframes" || engine === "auto") && (useImages || !!videoAbs) && !tooLongForHF;
  if (tooLongForHF) {
    console.warn(`[render] 时长 ${dur.toFixed(0)}s > ${hfMaxSec}s，走 ffmpeg（HyperFrames 长视频逐帧截图过慢）。如需强制 HTML 渲染设 RENDER_ENGINE=hyperframes 且 RENDER_ENGINE_FORCE=1`);
  }
  if (wantHF) {
    try {
      const rendered: { filename: string; style: RenderStyle; motion: RenderMotion; background: string }[] = [];
      for (let v = 0; v < variants.length; v++) {
        const variant = variants[v];
        const title = titleForVariant(variant, task, bookMeta, titleText);
        const statementText = statementForVariant(variant, task, bookMeta);
        const hookText = variant.style === "chapters" ? "" : hookTextForVariant(task, bookMeta, cues);
        const ctaText = ctaTextForVariant(task, bookMeta);
        setStepStatus(taskId, "render", { progress: 0.15 + 0.75 * (v / variants.length) });
        const out = await renderWithHyperframes({ dir, videoAbs, images: useImages ? renderImages : [], audioAbs, cues, dur, segDurs, title, hookText, ctaText, highlightTerms, variant, statementText });
        const hfBackground = useImages ? "images" : "video";
        saveArtifact({
          taskId, stepName: "render", kind: "video", label: variant.label,
          path: path.relative(process.cwd(), out),
          meta: {
            durationSec: +dur.toFixed(2), cues: cues.length, background: hfBackground, engine: "hyperframes",
            hasTitle: !!title, hasStatement: !!statementText,
            hasHook: !!hookText, hasCta: !!ctaText, highlightTerms,
            imageTiming: hfBackground === "images" ? (videoCover ? "cover-first+voice-segments" : "voice-segments") : undefined,
            videoCover: !!videoCover,
            style: variant.style, styleLabel: STYLE_LABELS[variant.style],
            motion: variant.motion, motionLabel: MOTION_LABELS[variant.motion],
            variantIndex: variant.index, filename: variant.filename,
          },
        });
        rendered.push({ filename: variant.filename, style: variant.style, motion: variant.motion, background: hfBackground });
      }
      setStepStatus(taskId, "render", { progress: 0.95 });
      setStepStatus(taskId, "render", {
        output: JSON.stringify({
          finals: rendered.map((r) => r.filename),
          count: rendered.length, dur: +dur.toFixed(2), cues: cues.length,
          background: useImages ? "images" : "video", engine: "hyperframes", variants: rendered,
        }),
      });
      return;
    } catch (e: any) {
      if (engine === "hyperframes") throw e; // 显式指定 HF 时不回退，直接暴露错误
      console.warn("[render] HyperFrames 失败，回退 ffmpeg：", String(e?.message || e));
      try { fs.writeFileSync(path.join(dir, "_hyperframes_fallback.log"), String(e?.message || e)); } catch {}
    }
  }

  // ===== 兜底/批量：纯 ffmpeg + ASS 字幕 + 少量 PNG 叠层（不依赖 Chromium/网络）=====
  const font = findFont();
  const rendered: { filename: string; style: RenderStyle; motion: RenderMotion; background: string }[] = [];
  const slideshowCache = new Map<string, string | null>();
  async function slideshowForVariant(variant: RenderVariant): Promise<string | null> {
    if (!useImages) return null;
    const opts = slideshowOptionsForStyle(variant.style);
    const minHold = Math.max(1.2, Number(process.env.RENDER_IMAGE_MIN_HOLD_SEC || 5.5));
    const slides = buildTimedSlides(renderImages.map((a) => ({ path: a.path! })), segDurs, dur, { minHoldSec: minHold });
    const timingKey = crypto
      .createHash("sha1")
      .update(JSON.stringify(slides.map((slide) => [slide.sourceIndex, slide.duration.toFixed(3)])))
      .digest("hex")
      .slice(0, 12);
    const key = `${slideshowCacheKey(opts)}-voice-${slides.length}-${timingKey}`;
    if (slideshowCache.has(key)) return slideshowCache.get(key) || null;
    setStepStatus(taskId, "render", {
      progress: 0.12,
      output: JSON.stringify({
        phase: "build-image-slideshow",
        images: renderImages.length,
        videoCover: !!videoCover,
        slides: slides.length,
        timing: "voice-segments",
        variants: variants.length,
        size: `${opts.width}x${opts.height}`,
        fit: opts.fit,
      }),
    });
    const slideshow = await buildSlideshow(
      slides,
      dur,
      dir,
      `.render.${key}.slideshow.${process.pid}`,
      opts,
    );
    slideshowCache.set(key, slideshow);
    return slideshow;
  }

  for (let v = 0; v < variants.length; v++) {
    const variant = variants[v];
    const isBookTemplate = variant.style === "book";
    const mediaFrame = mediaFrameForStyle(variant.style);
    const isFramedTemplate = isFramedStyle(variant.style);
    const visual = STYLE_VISUALS[variant.style];
    const offset = variantOffset(variant);
    const motionLayout = isBookTemplate ? BOOK_MOTION_LAYOUT_OFFSETS[variant.motion] : MOTION_LAYOUT_OFFSETS[variant.motion];
    const titleY = visual.titleY + offset * 30 + motionLayout.titleY;
    const subY = visual.subY - offset * 28 + motionLayout.subY;
    const statementY = visual.statementY - offset * 18 + motionLayout.statementY;
    const title = titleForVariant(variant, task, bookMeta, titleText);
    const authorText = authorForVariant(variant, task, bookMeta);
    const statementText = statementForVariant(variant, task, bookMeta);
    const hookText = variant.style === "chapters" ? "" : hookTextForVariant(task, bookMeta, cues);
    const ctaText = ctaTextForVariant(task, bookMeta);

    setStepStatus(taskId, "render", { progress: 0.15 + 0.75 * (v / variants.length) });

    const prefix = fileStem(variant.filename);
    const slideshow = await slideshowForVariant(variant);
    const assPath = path.join(dir, `${prefix}_subtitles.ass`);
    const subtitleAss = writeAssSubtitles({
      cues,
      dur,
      font,
      visual,
      offset,
      subY,
      highlightTerms,
      suppressBefore: hookText ? 3.45 : 0,
      out: assPath,
    });
    const items: any[] = [];
    let hookPng: { out: string; w: number; h: number } | null = null;
    let titlePng: { out: string; w: number; h: number } | null = null;
    let authorPng: { out: string; w: number; h: number } | null = null;
    let statementPng: { out: string; w: number; h: number } | null = null;
    let ctaPng: { out: string; w: number; h: number } | null = null;
    const chapterMarkers = variant.style === "chapters" ? buildChapterMarkers(cues, dur) : [];
    let chapterPngs: { marker: ChapterMarker; png: { out: string; w: number; h: number } }[] = [];
    if (hookText) {
      items.push({
        text: hookText, out: path.join(dir, `${prefix}_hook.png`),
        fontsize: variant.style === "quote" ? 84 : variant.style === "book" || variant.style === "showcase" ? 56 : variant.style === "notes" ? 42 : 68,
        stroke: variant.style === "notes" ? 2 : 6,
        width: variant.style === "book" || variant.style === "showcase" ? 940 : variant.style === "notes" ? 900 : 1020,
        pad: 18,
        fill: variant.style === "book" || variant.style === "showcase" ? [255, 226, 46, 255] : variant.style === "notes" ? [38, 33, 26, 255] : [255, 255, 255, 255],
        stroke_fill: [0, 0, 0, 235],
        max_lines: variant.style === "quote" ? 2 : 3,
      });
    }
    if (title) {
      items.push({
        text: title, out: path.join(dir, `${prefix}_title.png`),
        fontsize: visual.titleSize, stroke: variant.style === "book" ? 3 : 8, width: 1080, pad: 16,
        fill: indexedFill(visual.titleFill, offset), stroke_fill: visual.titleStroke,
        max_lines: variant.style === "book" ? 2 : 3,
      });
    }
    for (const marker of chapterMarkers) {
      items.push({
        text: marker.title,
        out: path.join(dir, `${prefix}_chapter_${String(marker.index).padStart(2, "0")}.png`),
        fontsize: 48,
        stroke: 3,
        width: 980,
        pad: 12,
        fill: [229, 246, 242, 255],
        stroke_fill: [5, 19, 22, 240],
        max_lines: 2,
      });
    }
    if (authorText) {
      items.push({
        text: `${authorText} 著`, out: path.join(dir, `${prefix}_author.png`),
        fontsize: 44, stroke: 1, width: 1080, pad: 10,
        fill: [178, 182, 182, 255], stroke_fill: [0, 0, 0, 180],
        max_lines: 1,
      });
    }
    if (statementText) {
      const isBook = variant.style === "book" || variant.style === "showcase";
      items.push({
        text: statementText, out: path.join(dir, `${prefix}_statement.png`),
        fontsize: isBook ? 32 : variant.style === "notes" ? 28 : 34,
        stroke: isBook || variant.style === "notes" ? 2 : 4,
        width: isBook ? 910 : 980,
        pad: 10,
        fill: isBook ? [255, 247, 196, 255] : variant.style === "notes" ? [104, 92, 76, 255] : [245, 245, 245, 255],
        stroke_fill: [0, 0, 0, 220],
        max_lines: isBook ? 4 : 3,
      });
    }
    if (ctaText) {
      items.push({
        text: ctaText, out: path.join(dir, `${prefix}_cta.png`),
        fontsize: variant.style === "book" || variant.style === "showcase" ? 42 : variant.style === "chapters" ? 34 : 46,
        stroke: variant.style === "chapters" ? 4 : 5,
        width: variant.style === "chapters" ? 880 : 980,
        pad: 16,
        fill: variant.style === "book" || variant.style === "showcase" ? [255, 226, 46, 255] : [255, 255, 255, 255],
        stroke_fill: [0, 0, 0, 230],
        max_lines: variant.style === "chapters" ? 2 : 3,
      });
    }

    const pngs = await renderTexts(font, items, dir);
    let nextPng = 0;
    if (hookText) hookPng = pngs[nextPng++];
    if (title) titlePng = pngs[nextPng++];
    chapterPngs = chapterMarkers.map((marker) => ({ marker, png: pngs[nextPng++] }));
    if (authorText) authorPng = pngs[nextPng++];
    if (statementText) statementPng = pngs[nextPng++];
    if (ctaText) ctaPng = pngs[nextPng++];

    const inputs: string[] = [];
    let bgKind: string;
    if (slideshow) {
      inputs.push("-stream_loop", "-1", "-i", slideshow);
      bgKind = "images";
    } else if (videoAbs) {
      inputs.push("-stream_loop", "-1", "-i", videoAbs);
      bgKind = "video";
    } else {
      inputs.push("-f", "lavfi", "-i", `color=c=${backgroundColorForVariant(variant)}:s=1080x1920:d=${Math.ceil(dur) + 1}`);
      bgKind = "color";
    }
    let nextInputIdx = 1;
    let titleIdx = -1;
    if (titlePng) {
      titleIdx = nextInputIdx++;
      inputs.push("-loop", "1", "-i", path.resolve(titlePng.out));
    }
    const chapterInputs = chapterPngs.map(({ marker, png }) => {
      const idx = nextInputIdx++;
      inputs.push("-loop", "1", "-i", path.resolve(png.out));
      return { marker, png, inputIdx: idx };
    });
    let hookIdx = -1;
    if (hookPng) {
      hookIdx = nextInputIdx++;
      inputs.push("-loop", "1", "-i", path.resolve(hookPng.out));
    }
    let authorIdx = -1;
    if (authorPng) {
      authorIdx = nextInputIdx++;
      inputs.push("-loop", "1", "-i", path.resolve(authorPng.out));
    }
    let statementIdx = -1;
    if (statementPng) {
      statementIdx = nextInputIdx++;
      inputs.push("-loop", "1", "-i", path.resolve(statementPng.out));
    }
    let ctaIdx = -1;
    if (ctaPng) {
      ctaIdx = nextInputIdx++;
      inputs.push("-loop", "1", "-i", path.resolve(ctaPng.out));
    }
    inputs.push("-i", audioAbs);
    const audioIdx = nextInputIdx;
    const imageTemplate = slideshow ? IMAGE_MOTION_TEMPLATES[variant.motion] : null;
    const motionFilter = imageTemplate ? imageTemplate.filter : MOTION_BG_FILTERS[variant.motion];

    const bgFilter = isFramedTemplate && mediaFrame
      ? [
          ...(slideshow
            ? ["setsar=1"]
            : [
                `scale=1080:${mediaFrame.h}:force_original_aspect_ratio=increase`,
                `crop=1080:${mediaFrame.h}`,
                "setsar=1",
              ]),
          visual.filter,
          variantFilter(variant),
          motionFilter,
          "setsar=1",
          "format=yuv420p",
        ].filter(Boolean).join(",")
      : [
          "scale=1080:1920:force_original_aspect_ratio=increase",
          "crop=1080:1920",
          "setsar=1",
          visual.filter,
          variantFilter(variant),
          motionFilter,
          "setsar=1",
          "format=yuv420p",
        ].filter(Boolean).join(",");
    let fc = isFramedTemplate && mediaFrame
      ? `[0:v]${bgFilter}[media];color=c=${backgroundColorForVariant(variant)}:s=1080x1920:d=${Math.ceil(dur) + 1}[canvas];[canvas][media]overlay=x=0:y=${mediaFrame.y}[bg];`
      : `[0:v]${bgFilter}[bg];`;
    let last = "bg";
    const preDecor = templatePreSubDecor(variant.style, last, dur, variant);
    fc += preDecor.fc;
    last = preDecor.last;
    if (variant.style === "chapters" && chapterMarkers.length) {
      for (const marker of chapterMarkers) {
        const out = `vprog_${marker.index}`;
        const progressW = Math.max(90, Math.min(908, Math.round(908 * marker.progress)));
        fc += boxLayer(last, out, 86, 118, progressW, 10, ffColor("#FFE135", .95), "fill", `between(t,${marker.start.toFixed(3)},${marker.end.toFixed(3)})`);
        last = out;
      }
    }
    if (titlePng) {
      fc += `[${titleIdx}:v]format=rgba[tt];[${last}][tt]overlay=x=(W-w)/2:y=${titleY}[vt];`;
      last = "vt";
    }
    for (const chapter of chapterInputs) {
      const out = `vchapter_${chapter.marker.index}`;
      fc += `[${chapter.inputIdx}:v]format=rgba[ch${chapter.marker.index}];[${last}][ch${chapter.marker.index}]overlay=x=(W-w)/2:y=${titleY}:enable='between(t,${chapter.marker.start.toFixed(3)},${chapter.marker.end.toFixed(3)})'[${out}];`;
      last = out;
    }
    if (hookPng) {
      const hookY = variant.style === "book" ? 330 : variant.style === "showcase" ? 355 : variant.style === "quote" ? 520 : variant.style === "notes" ? 1130 : 360;
      fc += `[${hookIdx}:v]format=rgba[hk];[${last}][hk]overlay=x=(W-w)/2:y=${hookY}:enable='between(t,0,3.4)'[vh];`;
      last = "vh";
    }
    if (authorPng) {
      fc += `[${authorIdx}:v]format=rgba[au];[${last}][au]overlay=x=(W-w)/2:y=${BOOK_CARD_FRAME.authorY}[va];`;
      last = "va";
    }
    const postDecor = templatePostSubDecor(variant.style, last, variant);
    fc += postDecor.fc;
    last = postDecor.last;
    const assFilter = [
      `filename=${escapeFfmpegFilterValue(path.resolve(subtitleAss.path))}`,
      `fontsdir=${escapeFfmpegFilterValue(path.dirname(font))}`,
    ].join(":");
    fc += `[${last}]ass=${assFilter}[vsub];`;
    last = "vsub";
    if (statementPng) {
      fc += `[${statementIdx}:v]format=rgba[st];[${last}][st]overlay=x=(W-w)/2:y=${statementY}[vs];`;
      last = "vs";
    }
    if (ctaPng) {
      const ctaStart = (variant.style === "chapters" ? 0 : Math.max(0, dur - 4.2)).toFixed(3);
      const ctaY = variant.style === "book" || variant.style === "showcase" ? 1510 : variant.style === "chapters" ? 308 : variant.style === "desk" ? 1540 : 1280;
      fc += `[${ctaIdx}:v]format=rgba[cta];[${last}][cta]overlay=x=(W-w)/2:y=${ctaY}:enable='gte(t,${ctaStart})'[vc];`;
      last = "vc";
    }
    fc = fc.replace(/;$/, "");

    const finalPath = path.join(dir, variant.filename);
    if (slideshow && path.resolve(slideshow) === path.resolve(finalPath)) {
      throw new Error(`render 临时轮播文件与最终输出路径冲突: ${variant.filename}`);
    }
    const tmpFinalPath = path.join(dir, `.${prefix}.${process.pid}.tmp.mp4`);
    removeZeroByteFile(finalPath);
    try { fs.unlinkSync(tmpFinalPath); } catch {}

    const args = [
      "-y", "-nostdin", ...inputs,
      "-filter_complex", fc,
      "-map", `[${last}]`, "-map", `${audioIdx}:a`,
      "-t", String(dur),
      "-c:v", "libx264", "-preset", RENDER_PRESET, "-crf", RENDER_CRF, "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-shortest", path.resolve(tmpFinalPath),
    ];

    try {
      await execFileP(FFMPEG_BIN, args, { cwd: dir, maxBuffer: 1024 * 1024 * 256 });
      promoteNonEmptyOutput(tmpFinalPath, finalPath, `ffmpeg ${variant.filename}`);
    } catch (e: any) {
      const full = String(e?.stderr || e?.message || e);
      try { fs.unlinkSync(tmpFinalPath); } catch {}
      try { fs.writeFileSync(path.join(dir, `_render_err_${prefix}.log`), "ARGS:\n" + JSON.stringify(args, null, 2) + "\n\nSTDERR:\n" + full); } catch {}
      throw new Error(`ffmpeg 渲染失败(${variant.label}): ` + full.slice(-600));
    }

    for (const s of pngs) { try { fs.unlinkSync(s.out); } catch {} }
    try { fs.unlinkSync(subtitleAss.path); } catch {}
    try { fs.unlinkSync(path.join(dir, `_render_err_${prefix}.log`)); } catch {}

    saveArtifact({
      taskId, stepName: "render", kind: "video", label: variant.label,
      path: path.relative(process.cwd(), finalPath),
      meta: {
        durationSec: +dur.toFixed(2), cues: cues.length, background: bgKind, images: images.length,
        videoCover: !!videoCover,
        hasTitle: !!titlePng, hasStatement: !!statementPng, hasHook: !!hookPng, hasCta: !!ctaPng,
        highlightTerms, font, engine: "ffmpeg",
        subtitleMode: "ass", subtitleEvents: subtitleAss.events, ffmpegInputs: audioIdx + 1,
        style: variant.style, styleLabel: STYLE_LABELS[variant.style],
        layoutTemplate: isFramedTemplate ? `${variant.style}-framed` : "full-frame",
        mediaFit: slideshow ? slideshowOptionsForStyle(variant.style).fit : undefined,
        imageTiming: slideshow ? (videoCover ? "cover-first+voice-segments" : "voice-segments") : undefined,
        mediaFrame: mediaFrame
          ? { width: 1080, height: mediaFrame.h, y: mediaFrame.y }
          : { width: 1080, height: 1920, y: 0 },
        motion: variant.motion, motionLabel: MOTION_LABELS[variant.motion],
        motionFilter: imageTemplate?.profile || "animated-crop",
        variantIndex: variant.index, filename: variant.filename,
      },
    });
    rendered.push({ filename: variant.filename, style: variant.style, motion: variant.motion, background: bgKind });
    setStepStatus(taskId, "render", { progress: 0.15 + 0.8 * ((v + 1) / variants.length) });
  }

  for (const slideshow of new Set([...slideshowCache.values()].filter((p): p is string => !!p))) {
    try { fs.unlinkSync(slideshow); } catch {}
  }
  try { fs.unlinkSync(path.join(dir, "_render_err.log")); } catch {}
  setStepStatus(taskId, "render", { progress: 0.95 });
  setStepStatus(taskId, "render", {
    output: JSON.stringify({
      finals: rendered.map((r) => r.filename),
      count: rendered.length, dur: +dur.toFixed(2), cues: cues.length,
      engine: "ffmpeg", variants: rendered,
    }),
  });
}
