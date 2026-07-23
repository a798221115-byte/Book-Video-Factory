// Pipeline step 定义 + 依赖关系（决定重跑级联）
export const STEP_NAMES = [
  "extract",    // 热点采集：链接 -> 视频+meta+原始ASR
  "transcribe", // 转写+清洗：原始ASR -> 干净正文（附件A）
  "analyze",    // 图书候选 + 爆款结构分析，完成后等待人工确认
  "rewrite",    // 改写+书名识别：清洗稿 -> 改写候选（附件B）+ 书名JSON（附件D）
  "tts",        // 配音：改写稿 -> 切分（附件F）-> index-tts2 -> 音频
  "images",     // 配图：九宫格 gpt-image-2 -> 裁 9 张分镜（附件E）
  "subtitle",   // 字幕对齐：tts.wav -> Whisper词级时间戳 -> SRT
  "render",     // 成片：背景视频+字幕+音频 -> HyperFrames/ffmpeg -> mp4
] as const;

export type StepName = (typeof STEP_NAMES)[number];
export const INTAKE_STEP_NAMES: StepName[] = ["extract", "transcribe", "analyze"];

// 当前全链默认跑完所有步骤。保留该列表用于未来重新引入可选步骤。
export const OPTIONAL_STEPS: StepName[] = [];

// 每步依赖的上游步骤（重跑某步时，下游自动失效/级联）
export const STEP_DEPS: Record<StepName, StepName[]> = {
  extract: [],
  transcribe: ["extract"],
  analyze: ["transcribe"],
  rewrite: ["transcribe"],
  tts: ["rewrite"],
  subtitle: ["tts"],
  images: ["rewrite"], // 默认按改写后的正式口播分段生成配图数量，TTS 与配图可并行。
  render: ["subtitle", "tts", "extract", "images"],
};

export const STEP_LABELS: Record<StepName, string> = {
  extract: "采集",
  transcribe: "转写+清洗",
  analyze: "图书与爆款分析",
  rewrite: "改写+书名识别",
  tts: "TTS 配音",
  subtitle: "字幕对齐",
  images: "配图",
  render: "成片导出",
};

// 给定要重跑的步骤，返回所有需要级联失效的下游步骤
export function downstreamOf(name: StepName): StepName[] {
  const result: StepName[] = [];
  const visit = (n: StepName) => {
    for (const s of STEP_NAMES) {
      if (STEP_DEPS[s].includes(n) && !result.includes(s)) {
        result.push(s);
        visit(s);
      }
    }
  };
  visit(name);
  return result;
}
