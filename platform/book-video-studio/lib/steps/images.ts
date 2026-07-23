import { getTask, setStepStatus, saveArtifact, getArtifacts, clearArtifactsByKind, taskDir } from "../pipeline/repo";
import { getLLM } from "../providers/llm";
import { getImage, getImageChannelCount, ImageProviderError, type ImageChannelError, type ImageGenerateProgress } from "../providers/image";
import { PROMPT_E_IMAGE, PROMPT_E_BRIEF, PROMPT_E_BRIEF_EXPAND } from "../prompts";
import { getImageModeConfig, type ImageMode } from "../imageModes";
import { getImageStyleConfig, type ImageStyleConfig } from "../imageStyles";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { buildFallbackImageBriefs, expandImageBriefs, selectQualityImageBriefs } from "./imageBriefs";
import { parseSegmentArtifactMeta } from "./scriptSegments";

const execFileP = promisify(execFile);
const CROP_PY = path.resolve(process.cwd(), "workers/image_grid/crop_grid.py");
const SMALL_GROUP_SINGLE_THRESHOLD = 2;
const DEFAULT_IMAGE_TARGET_COUNT = 63;
const SINGLE_IMAGE_TIMEOUT_MS = Math.max(30_000, Math.min(600_000, Number(process.env.IMAGE_SINGLE_TIMEOUT_MS || process.env.IMAGE_TIMEOUT_MS) || 180_000));
const IMAGE_GRID_CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.IMAGE_GRID_CONCURRENCY) || getImageChannelCount()));
const FORCE_SINGLE_IMAGES = process.env.IMAGE_FORCE_SINGLE === "1";

type ImageCell = {
  path: string;
  brief: string;
  briefIndex: number;
  segmentIndex: number;
  segmentTextPreview: string;
  grid: number;
  gridCell: number;
  source: "grid" | "single";
  gridImageSize?: string;
  provider?: string;
};

type FailedGrid = {
  grid: number;
  briefs: number;
  mode: "grid" | "single";
  error: string;
  cell?: number;
  provider?: string;
  errorKind?: string;
  channelErrors?: ImageChannelError[];
};

type ChannelIssueGrid = FailedGrid;

function roundUpToGridCount(count: number) {
  if (FORCE_SINGLE_IMAGES) return count;
  return Math.ceil(count / 9) * 9;
}

function resolveTargetCount(configuredTargetCount: number, segmentCount: number) {
  if (Number.isFinite(configuredTargetCount) && configuredTargetCount > 0) {
    return Math.max(9, Math.min(90, Math.floor(configuredTargetCount)));
  }
  const baseCount = segmentCount > 0 ? segmentCount : DEFAULT_IMAGE_TARGET_COUNT;
  return Math.max(9, Math.min(90, roundUpToGridCount(baseCount)));
}

function describeImageFailure(error: unknown) {
  if (error instanceof ImageProviderError) {
    return {
      error: error.message,
      provider: error.provider,
      errorKind: error.kind,
      channelErrors: error.channelErrors,
      hardFailure: error.kind === "http" || error.kind === "empty",
    };
  }
  return {
    error: String((error as any)?.message || error),
    provider: undefined,
    errorKind: "unknown",
    channelErrors: undefined,
    hardFailure: false,
  };
}

// 把每段文案转成画面 brief（失败则用前 20 字兜底）
// 把一组（≤9）文案转成画面 brief；带重试，失败则该组用前 18 字兜底
async function makeBriefs(segments: string[]): Promise<string[]> {
  if (FORCE_SINGLE_IMAGES || process.env.IMAGE_FAST_BRIEFS === "1") {
    return buildFallbackImageBriefs(segments, [], segments.length);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await getLLM().chat({
        system: PROMPT_E_BRIEF.system,
        user: PROMPT_E_BRIEF.user({ segments }),
        temperature: 0.4, json: true,
      });
      const arr = JSON.parse(raw)?.briefs;
      if (Array.isArray(arr)) {
        const briefs = selectQualityImageBriefs(segments, arr, segments.length);
        if (briefs.length >= Math.ceil(segments.length / 2)) {
          return buildFallbackImageBriefs(segments, briefs, segments.length);
        }
      }
    } catch { /* 重试 */ }
    await new Promise((r) => setTimeout(r, 800));
  }
  return buildFallbackImageBriefs(segments, [], segments.length);
}

async function expandBriefs(sourceSegments: string[], existingBriefs: string[], targetCount: number): Promise<string[]> {
  if (FORCE_SINGLE_IMAGES || process.env.IMAGE_FAST_BRIEFS === "1") {
    return buildFallbackImageBriefs(sourceSegments, existingBriefs, targetCount);
  }
  return expandImageBriefs(sourceSegments, existingBriefs, targetCount, async ({ sourceSegments, existingBriefs, targetCount }) => {
    const raw = await getLLM().chat({
      system: PROMPT_E_BRIEF_EXPAND.system,
      user: PROMPT_E_BRIEF_EXPAND.user({
        source_segments: sourceSegments,
        existing_briefs: existingBriefs,
        target_count: targetCount,
      }),
      temperature: 0.45,
      json: true,
    });
    const arr = JSON.parse(raw)?.briefs;
    return Array.isArray(arr) ? arr : [];
  });
}

async function cropGrid(grid: string, dir: string, prefix: string, mode: ImageMode): Promise<string[]> {
  const cfg = path.join(dir, `_cropcfg_${process.pid}_${Date.now()}.json`);
  const { config: modeConfig } = getImageModeConfig(mode);
  fs.writeFileSync(cfg, JSON.stringify({
    grid,
    out_dir: dir,
    out_prefix: prefix,
    inset: 0.02,
    output_width: modeConfig.outputWidth,
    output_height: modeConfig.outputHeight,
  }), "utf-8");
  try {
    const { stdout } = await execFileP("python3", [CROP_PY, cfg], { maxBuffer: 1024 * 1024 * 16 });
    return JSON.parse(stdout).cells as string[];
  } finally {
    try { fs.unlinkSync(cfg); } catch {}
  }
}

async function fitSingleImage(inputPath: string, outputPath: string, mode: ImageMode): Promise<string> {
  const cfg = path.join(path.dirname(outputPath), `_fitcfg_${process.pid}_${Date.now()}.json`);
  const { config: modeConfig } = getImageModeConfig(mode);
  fs.writeFileSync(cfg, JSON.stringify({
    single: true,
    grid: inputPath,
    out_path: outputPath,
    output_width: modeConfig.outputWidth,
    output_height: modeConfig.outputHeight,
  }), "utf-8");
  try {
    const { stdout } = await execFileP("python3", [CROP_PY, cfg], { maxBuffer: 1024 * 1024 * 16 });
    const cells = JSON.parse(stdout).cells as string[];
    return cells[0] || outputPath;
  } finally {
    try { fs.unlinkSync(cfg); } catch {}
  }
}

function singleImagePrompt(input: {
  bookTitle: string;
  bookAuthor: string;
  brief: string;
  index: number;
  total: number;
  mode: ImageMode;
  imageStyle: ImageStyleConfig;
}) {
  const aspectCopy = input.mode === "wide"
    ? "16:9 横版构图，主体位于中央安全区，便于横版复用或后续竖屏中心裁切。"
    : "1:1 方形构图，主体位于中央安全区，便于竖版短视频背景裁切。";
  return `为中文短视频口播生成一张独立分镜候选图。

主题书籍：${input.bookTitle || "图书分享"}
作者：${input.bookAuthor || ""}
分镜编号：${input.index + 1}/${input.total}
画面 brief：${input.brief || "安静明亮的阅读与生活方式场景"}
画幅要求：${aspectCopy}

统一视觉风格：
${input.imageStyle.styleBible}

要求：
- ${input.imageStyle.promptLine}
- 优先生成书桌、窗边、日常物件、背影、侧影、空房间、光影和生活场景；人物不是必须出现。
- 如出现人物，只允许自然背影、远景侧影或手部局部，姿态正常，比例准确，不要正脸、半躺病床人物、近景脸部或复杂肢体。
- 主体明确，边缘不要放关键人物、文字或核心物件。
- 不要出现任何可读文字、字幕、书名、水印、二维码、品牌标识。
- 避免医疗病理、伤口、病床、医院病房、手术室、注射器、检查仪器等画面，用窗边、餐桌、走廊、报告单边角或安静生活场景隐喻健康主题。
- 避免 AI 感明显的手指、扭曲肢体、畸形面部、塑料质感和过度摆拍。

只生成图片，不要输出解释。`;
}

function readImageConfig(arts: ReturnType<typeof getArtifacts>) {
  for (const a of arts) {
    if (a.stepName !== "config" || a.kind !== "json" || !a.meta) continue;
    try {
      const meta = JSON.parse(a.meta);
      if (meta.key === "images" && meta.value && typeof meta.value === "object") return meta.value;
    } catch { /* ignore bad config */ }
  }
  return {};
}

export async function runImages(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  const initialArts = getArtifacts(taskId);
  const imageConfig = readImageConfig(initialArts);
  const resumeEnabled = imageConfig.resume !== false;
  const existingImageArtifacts = resumeEnabled
    ? initialArts.filter((a) => a.stepName === "images" && a.kind === "image" && a.path && fs.existsSync(path.resolve(a.path)))
    : [];
  if (!resumeEnabled) {
    clearArtifactsByKind(taskId, "images", "image");
    // 清理上次残留的分镜/总图文件（避免重跑后磁盘堆积旧图），保留 video-cover。
    const dirEarly = taskDir(taskId);
    for (const f of fs.readdirSync(dirEarly)) {
      if (/^img_\d+_\d+\.jpg$/.test(f) || /^grid_\d+\.png$/.test(f) || /^single_\d+_\d+\.png$/.test(f)) {
        try { fs.unlinkSync(path.join(dirEarly, f)); } catch { /* */ }
      }
    }
  }

  // 段落来源：优先 rewrite 阶段的正式口播分段；老任务兼容 tts 分段和按句切。
  const arts = resumeEnabled ? initialArts : getArtifacts(taskId);
  const configuredTargetCount = Number(imageConfig.targetCount || 0);
  const { mode: imageMode, config: modeConfig } = getImageModeConfig(imageConfig.mode);
  const { style: imageStyle, config: imageStyleConfig } = getImageStyleConfig(imageConfig.style);
  const imageQuality = imageConfig.quality === "fast" ? "fast" : "high";
  const gridImageSize = imageQuality === "high" ? modeConfig.highGridImageSize : modeConfig.imageSize;
  let segments: string[] = [];
  const rewriteSegments = arts.find((a) => a.stepName === "rewrite" && a.kind === "segments");
  segments = parseSegmentArtifactMeta(rewriteSegments?.meta);
  const ttsAudio = arts.find((a) => a.stepName === "tts" && a.kind === "audio");
  if (ttsAudio?.meta) {
    const ttsSegments = parseSegmentArtifactMeta(ttsAudio.meta);
    if (!segments.length) segments = ttsSegments;
  }
  if (!segments.length) {
    const script = arts.find((a) => a.stepName === "rewrite" && a.kind === "rewrite")?.content;
    if (!script) throw new Error("缺少分段来源（tts 或 rewrite 产物）");
    segments = script.split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean);
  }
  const targetCount = resolveTargetCount(configuredTargetCount, segments.length);
  const segmentIndexForBrief = (briefIndex: number) => {
    if (!segments.length) return 0;
    return Math.max(0, Math.min(segments.length - 1, Math.floor(briefIndex * segments.length / Math.max(1, targetCount))));
  };
  const segmentPreviewForBrief = (briefIndex: number) => (
    (segments[segmentIndexForBrief(briefIndex)] || "").replace(/\s+/g, " ").slice(0, 80)
  );

  setStepStatus(taskId, "images", {
    progress: 0.1,
    output: JSON.stringify({
      phase: "briefs",
      cells: existingImageArtifacts.length,
      savedCells: existingImageArtifacts.length,
      reusedCells: existingImageArtifacts.length,
      targetCount,
      failedGrids: [],
    }),
  });

  // 先按真实口播段生成基础 brief；若目标数量更大，再扩写到足量 brief。
  const dir = taskDir(taskId);
  const img = getImage();
  const baseBriefs = await makeBriefs(segments);
  const targetBriefCount = targetCount;
  const briefs = await expandBriefs(segments, baseBriefs, targetBriefCount);
  const groupSize = FORCE_SINGLE_IMAGES ? 1 : 9;
  const segGroups: string[][] = [];
  for (let i = 0; i < briefs.length; i += groupSize) segGroups.push(briefs.slice(i, i + groupSize));

  const existingByBriefIndex = new Map<number, ImageCell>();
  for (const artifact of existingImageArtifacts) {
    const meta = artifact.meta ? JSON.parse(artifact.meta) : {};
    const briefIndex = Number(meta.briefIndex ?? meta.idx ?? -1);
    if (!Number.isFinite(briefIndex) || briefIndex < 0 || briefIndex >= targetCount || !artifact.path) continue;
    const segmentIndex = Number.isFinite(Number(meta.segmentIndex)) ? Number(meta.segmentIndex) : segmentIndexForBrief(briefIndex);
    existingByBriefIndex.set(briefIndex, {
      path: artifact.path,
      brief: String(meta.brief || artifact.label || ""),
      briefIndex,
      segmentIndex,
      segmentTextPreview: String(meta.segmentTextPreview || segmentPreviewForBrief(briefIndex)),
      grid: Number(meta.grid || Math.floor(briefIndex / groupSize) + 1),
      gridCell: Number(meta.gridCell || (briefIndex % groupSize) + 1),
      source: meta.source === "single" ? "single" : "grid",
      gridImageSize: meta.gridImageSize || gridImageSize,
      provider: meta.provider || img.name,
    });
  }
  const cells: ImageCell[] = Array.from(existingByBriefIndex.values()).sort((a, b) => a.briefIndex - b.briefIndex);
  const failedGrids: FailedGrid[] = [];
  const channelIssueGrids: ChannelIssueGrid[] = [];
  const smallGroupOptimizations: { grid: number; briefs: number; strategy: "single-images" }[] = [];

  const buildOutput = (phase: string, extra: Record<string, unknown> = {}) => JSON.stringify({
    provider: img.name,
    phase,
    grids: segGroups.length,
    cells: cells.length,
    savedCells: cells.length,
    reusedCells: existingByBriefIndex.size,
    segments: segments.length,
    briefs: briefs.length,
    targetCount,
    imageMode,
    imageStyle,
    imageQuality,
    gridImageSize,
    generationMode: FORCE_SINGLE_IMAGES ? "single" : "grid",
    outputSize: `${modeConfig.outputWidth}x${modeConfig.outputHeight}`,
    smallGroupStrategy: {
      threshold: SMALL_GROUP_SINGLE_THRESHOLD,
      optimized: smallGroupOptimizations,
    },
    failedGridCount: failedGrids.length,
    failedGrids,
    channelIssueGridCount: channelIssueGrids.length,
    channelIssueGrids,
    ...extra,
  });

  const groupProgress = (groupIndex: number, fraction: number) => {
    const total = Math.max(1, segGroups.length);
    const safeFraction = Math.max(0, Math.min(1, fraction));
    return Math.min(0.95, 0.25 + 0.7 * ((groupIndex + safeFraction) / total));
  };

  let lastReportedProgress = 0.25;
  const report = (progress: number, phase: string, extra: Record<string, unknown> = {}) => {
    lastReportedProgress = Math.max(lastReportedProgress, progress);
    setStepStatus(taskId, "images", { progress: lastReportedProgress, output: buildOutput(phase, extra) });
  };

  const providerProgress = (groupIndex: number, groupSize: number, phasePrefix: "grid" | "single", cellIndex = 0) =>
    (event: ImageGenerateProgress) => {
      const stageFractions: Record<ImageGenerateProgress["stage"], number> = {
        attempt: 0.04,
        waiting: Math.min(0.72, ((event.elapsedMs || 0) / Math.max(1, event.timeoutMs || 1)) * 0.72),
        response: 0.78,
        download: 0.82,
        retry: 0.1,
        fallback: 0.12,
      };
      const perAttempt = 0.82 / Math.max(1, event.maxAttempts);
      const providerFraction = Math.min(0.86, (event.attempt - 1) * perAttempt + stageFractions[event.stage] * perAttempt);
      const fraction = phasePrefix === "single" && groupSize > 0
        ? (cellIndex + providerFraction) / groupSize
        : providerFraction;
      report(groupProgress(groupIndex, fraction), `${phasePrefix}:${event.stage}`, {
        currentGrid: groupIndex + 1,
        currentGridSize: groupSize,
        currentCell: phasePrefix === "single" ? cellIndex + 1 : undefined,
        providerEvent: {
          ...event,
          elapsedSeconds: event.elapsedMs == null ? undefined : Math.round(event.elapsedMs / 1000),
          timeoutSeconds: event.timeoutMs == null ? undefined : Math.round(event.timeoutMs / 1000),
        },
      });
    };

  const saveImageCell = (cell: ImageCell) => {
    const idx = cells.length;
    saveArtifact({
      taskId, stepName: "images", kind: "image", label: `分镜 ${idx + 1}`,
      path: path.relative(process.cwd(), cell.path),
      meta: {
        idx,
        briefIndex: cell.briefIndex,
        segmentIndex: cell.segmentIndex,
        segmentBinding: segments.length ? `${cell.segmentIndex + 1}/${segments.length}` : "",
        segmentTextPreview: cell.segmentTextPreview,
        brief: cell.brief,
        provider: cell.provider || img.name,
        mode: imageMode,
        style: imageStyle,
        styleLabel: imageStyleConfig.label,
        aspectRatio: modeConfig.aspectRatio,
        width: modeConfig.outputWidth,
        height: modeConfig.outputHeight,
        grid: cell.grid,
        gridCell: cell.gridCell,
        source: cell.source,
      },
    });
    cells.push(cell);
  };

  report(0.25, "generating", { currentGrid: 0 });

  const processGroup = async (g: number): Promise<ImageCell[]> => {
    const cellBriefs = segGroups[g];
    const localCells: ImageCell[] = [];
    const useSingles = FORCE_SINGLE_IMAGES || (cellBriefs.length > 0 && cellBriefs.length <= SMALL_GROUP_SINGLE_THRESHOLD);
    if (useSingles) {
      smallGroupOptimizations.push({ grid: g + 1, briefs: cellBriefs.length, strategy: "single-images" });
    }
    report(groupProgress(g, 0), useSingles ? "single:start" : "grid:start", {
      currentGrid: g + 1,
      currentGridSize: cellBriefs.length,
      reusedCells: cellBriefs.filter((_brief, i) => existingByBriefIndex.has(g * groupSize + i)).length,
    });
    if (cellBriefs.every((_brief, i) => existingByBriefIndex.has(g * groupSize + i))) {
      report(groupProgress(g, 1), "grid:reused", {
        currentGrid: g + 1,
        currentGridSize: cellBriefs.length,
      });
      return localCells;
    }

    if (useSingles) {
      for (let i = 0; i < cellBriefs.length; i++) {
        const briefIndex = g * groupSize + i;
        if (existingByBriefIndex.has(briefIndex)) {
          report(groupProgress(g, (i + 1) / cellBriefs.length), "single:reused", {
            currentGrid: g + 1,
            currentGridSize: cellBriefs.length,
            currentCell: i + 1,
          });
          continue;
        }
        const tmpPath = path.join(dir, `single_${g}_${String(i).padStart(3, "0")}.png`);
        const outPath = path.join(dir, `img_${g}_${String(i).padStart(3, "0")}.jpg`);
        try {
          const generated = await img.generate(
            singleImagePrompt({
              bookTitle: task.bookTitle || task.title || "",
              bookAuthor: task.bookAuthor || "",
              brief: cellBriefs[i],
              index: briefIndex,
              total: briefs.length,
              mode: imageMode,
              imageStyle: imageStyleConfig,
            }),
            tmpPath,
            {
              size: modeConfig.imageSize,
              timeoutMs: SINGLE_IMAGE_TIMEOUT_MS,
              maxAttempts: 1,
              onProgress: providerProgress(g, cellBriefs.length, "single", i),
            },
          );
          const fitted = await fitSingleImage(tmpPath, outPath, imageMode);
          localCells.push({
            path: fitted,
            brief: cellBriefs[i],
            briefIndex,
            segmentIndex: segmentIndexForBrief(briefIndex),
            segmentTextPreview: segmentPreviewForBrief(briefIndex),
            grid: g + 1,
            gridCell: i + 1,
            source: "single",
            gridImageSize: modeConfig.imageSize,
            provider: generated.provider,
          });
          report(groupProgress(g, (i + 1) / cellBriefs.length), "single:saved", {
            currentGrid: g + 1,
            currentGridSize: cellBriefs.length,
            currentCell: i + 1,
          });
        } catch (e: any) {
          const failure = describeImageFailure(e);
          const issue: FailedGrid = {
            grid: g + 1,
            briefs: cellBriefs.length,
            mode: "single",
            cell: i + 1,
            error: failure.error.slice(0, 160),
            provider: failure.provider,
            errorKind: failure.errorKind,
            channelErrors: failure.channelErrors,
          };
          if (failure.hardFailure) failedGrids.push(issue);
          else channelIssueGrids.push(issue);
          report(groupProgress(g, (i + 1) / cellBriefs.length), failure.hardFailure ? "single:failed" : "single:unavailable", {
            currentGrid: g + 1,
            currentGridSize: cellBriefs.length,
            currentCell: i + 1,
          });
        } finally {
          try { fs.unlinkSync(tmpPath); } catch {}
        }
      }
      return localCells;
    }

    const gridPath = path.join(dir, `grid_${g}.png`);
    try {
      const generated = await img.generate(
        PROMPT_E_IMAGE.user({
          book_title: task.bookTitle || task.title || "",
          book_author: task.bookAuthor || "",
          grid_index: g + 1, grid_total: segGroups.length,
          cells: cellBriefs,
          grid_aspect_ratio: modeConfig.gridAspectRatio,
          cell_aspect_ratio: modeConfig.cellAspectRatio,
          style_bible: imageStyleConfig.styleBible,
          style_prompt: imageStyleConfig.promptLine,
        }),
        gridPath, {
          size: gridImageSize,
          onProgress: providerProgress(g, cellBriefs.length, "grid"),
        },
      );
      report(groupProgress(g, 0.88), "grid:cropping", {
        currentGrid: g + 1,
        currentGridSize: cellBriefs.length,
      });
      // 裁成 9 张（最后一组不足 9 段也裁 9 张，多出的丢弃）
      const cut = await cropGrid(gridPath, dir, `img_${g}_`, imageMode);
      for (let i = 0; i < cellBriefs.length && i < cut.length; i++) {
        const briefIndex = g * 9 + i;
        if (existingByBriefIndex.has(briefIndex)) {
          try { fs.unlinkSync(cut[i]); } catch {}
          continue;
        }
        localCells.push({
          path: cut[i],
          brief: cellBriefs[i],
          briefIndex,
          segmentIndex: segmentIndexForBrief(briefIndex),
          segmentTextPreview: segmentPreviewForBrief(briefIndex),
          grid: g + 1,
          gridCell: i + 1,
          source: "grid",
          gridImageSize,
          provider: generated.provider,
        });
      }
      report(groupProgress(g, 1), "grid:saved", {
        currentGrid: g + 1,
        currentGridSize: cellBriefs.length,
      });
    } catch (e: any) {
      const failure = describeImageFailure(e);
      const issue: FailedGrid = {
        grid: g + 1,
        briefs: cellBriefs.length,
        mode: "grid",
        error: failure.error.slice(0, 160),
        provider: failure.provider,
        errorKind: failure.errorKind,
        channelErrors: failure.channelErrors,
      };
      // 明确返回的接口错误才算失败；超时、断连、fetch failed 只记为通道问题。
      if (failure.hardFailure) failedGrids.push(issue);
      else channelIssueGrids.push(issue);
      report(groupProgress(g, 1), failure.hardFailure ? "grid:failed" : "grid:unavailable", {
        currentGrid: g + 1,
        currentGridSize: cellBriefs.length,
      });
    }
    try { fs.unlinkSync(gridPath); } catch {} // 总图用完即删，留分镜
    return localCells;
  };

  for (let start = 0; start < segGroups.length; start += IMAGE_GRID_CONCURRENCY) {
    const batch = segGroups
      .slice(start, start + IMAGE_GRID_CONCURRENCY)
      .map((_group, offset) => processGroup(start + offset));
    const batchCells = (await Promise.all(batch)).flat()
      .sort((a, b) => a.briefIndex - b.briefIndex);
    for (const cell of batchCells) saveImageCell(cell);
  }

  if (!cells.length) {
    setStepStatus(taskId, "images", { output: buildOutput("failed:no-cells") });
    const allIssues = [...failedGrids, ...channelIssueGrids];
    throw new Error(`配图未生成：${allIssues.map((f) => `第${f.grid}组 ${f.provider ? `${f.provider} ` : ""}${f.errorKind || "unknown"} ${f.error}`).join("；")}`);
  }

  setStepStatus(taskId, "images", {
    progress: 0.95,
    output: buildOutput(failedGrids.length || channelIssueGrids.length ? "done:partial" : "done"),
  });
}
