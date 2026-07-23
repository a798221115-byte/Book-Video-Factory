import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getArtifactById, getArtifacts, getTask, patchArtifact } from "@/lib/pipeline/repo";
import { getImage } from "@/lib/providers/image";
import { getImageModeConfig, type ImageModeConfig } from "@/lib/imageModes";
import { getImageStyleConfig, type ImageStyleConfig } from "@/lib/imageStyles";

const execFileP = promisify(execFile);
const FIT_IMAGE_PY = path.resolve(process.cwd(), "workers/image_grid/fit_image.py");

function singleImagePrompt(input: {
  bookTitle: string;
  bookAuthor: string;
  brief: string;
  index: number;
  mode: "square" | "wide";
  variant: number;
  imageStyle: ImageStyleConfig;
}) {
  const aspectCopy = input.mode === "wide" ? "16:9 横版构图，主体位于中央安全区，便于横版复用或后续竖屏中心裁切。" : "1:1 方形构图，主体位于中央安全区，便于竖版短视频背景裁切。";
  const variantDirections = [
    "换成更近的生活静物镜头，使用桌面、手部动作、窗光和浅景深表达。",
    "换成更开阔的环境镜头，使用客厅、阳台、步道或厨房空间表达。",
    "换成更强的动作瞬间，使用拿起、整理、翻页、行走、伸展等动态姿态表达。",
    "换成更安静的物件隐喻，使用书页、水杯、日历、餐盘、便签或植物表达。",
    "换成上午窗边日光构图，主体位置、景别和道具组合必须不同。",
  ];
  const variantDirection = variantDirections[input.variant % variantDirections.length];
  return `生成一张中文短视频分镜候选图。

主题书籍：${input.bookTitle || "图书解读"}
作者：${input.bookAuthor || "未知"}
分镜编号：${input.index + 1}
重生成版本：${input.variant + 1}
画面 brief：${input.brief || "安静明亮的阅读与生活方式场景"}
画幅要求：${aspectCopy}
本次变化指令：${variantDirection}

要求：
- ${input.imageStyle.promptLine}
- 统一视觉风格：${input.imageStyle.styleBible}
- 禁止暗色系、低调光、夜景、强暗角、压抑、破败、昏暗、阴暗、病房感画面。
- 必须与上一版明显不同：更换主体、构图、景别、道具组合和人物姿态，不要只改颜色或细节。
- 画面主体明确，边缘不要放关键人物、文字或核心物件。
- 不要出现任何可读文字、字幕、书名、水印、二维码、品牌标识。
- 避免医疗病理、伤口、病床、医院病房、手术室、注射器、检查仪器等画面。
- 人物不是必须出现；如出现人物，只允许自然背影、远景侧影或手部局部，避免正脸特写、复杂肢体和夸张表情。

只生成图片。`;
}

async function fitImage(inputPath: string, outputPath: string, modeConfig: ImageModeConfig) {
  const cfg = path.join(path.dirname(outputPath), `_fitcfg_${Date.now()}_${process.pid}.json`);
  fs.writeFileSync(cfg, JSON.stringify({
    input: inputPath,
    output: outputPath,
    output_width: modeConfig.outputWidth,
    output_height: modeConfig.outputHeight,
  }), "utf-8");
  try {
    await execFileP("python3", [FIT_IMAGE_PY, cfg], { maxBuffer: 1024 * 1024 * 16 });
  } finally {
    try { fs.unlinkSync(cfg); } catch { /* ignore cleanup */ }
  }
}

function readImageConfigStyle(taskId: string) {
  for (const a of getArtifacts(taskId)) {
    if (a.stepName !== "config" || a.kind !== "json" || !a.meta) continue;
    try {
      const meta = JSON.parse(a.meta);
      if (meta.key === "images" && meta.value && typeof meta.value === "object") return meta.value.style;
    } catch { /* ignore bad config */ }
  }
  return null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; artifactId: string }> }) {
  const { id, artifactId } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const artifact = getArtifactById(artifactId);
  if (!artifact || artifact.taskId !== id || artifact.stepName !== "images" || artifact.kind !== "image" || !artifact.path) {
    return NextResponse.json({ error: "image artifact not found" }, { status: 404 });
  }

  let meta: any = {};
  try { meta = artifact.meta ? JSON.parse(artifact.meta) : {}; } catch { meta = {}; }
  const idx = Number(meta.idx || 0);
  const regenerateCount = Math.max(0, Number(meta.regenerateCount || 0)) + 1;
  const { mode, config: modeConfig } = getImageModeConfig(meta.mode);
  const body = await req.json().catch(() => ({}));
  const { style: imageStyle, config: imageStyleConfig } = getImageStyleConfig(body.style || readImageConfigStyle(id) || meta.style);
  const outPath = path.resolve(artifact.path);
  const tmpPath = path.join(path.dirname(outPath), `_regen_${artifact.id}_${Date.now()}.png`);

  const prompt = singleImagePrompt({
    bookTitle: task.bookTitle || task.title || "",
    bookAuthor: task.bookAuthor || "",
    brief: meta.brief || artifact.label || "",
    index: idx,
    mode,
    variant: regenerateCount,
    imageStyle: imageStyleConfig,
  });

  const provider = getImage();
  try {
    await provider.generate(prompt, tmpPath, { size: modeConfig.imageSize });
    await fitImage(tmpPath, outPath, modeConfig);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup */ }
  }

  const nextMeta = {
    ...meta,
    provider: provider.name,
    mode,
    style: imageStyle,
    styleLabel: imageStyleConfig.label,
    aspectRatio: modeConfig.aspectRatio,
    width: modeConfig.outputWidth,
    height: modeConfig.outputHeight,
    regenerateCount,
    regeneratedAt: Date.now(),
  };
  patchArtifact(artifact.id, { meta: JSON.stringify(nextMeta) });

  return NextResponse.json({ ok: true, artifactId, provider: provider.name, style: imageStyle, regeneratedAt: nextMeta.regeneratedAt });
}
