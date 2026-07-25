export const STEP_NAMES = [
  "extract",
  "transcribe",
  "analyze",
  "rewrite",
  "tts",
  "images",
  "subtitle",
  "render",
  "topic_discovery",
  "text_compliance",
  "voice_timeline",
  "media_compliance",
  "draft_upload",
  "publication",
  "analytics",
] as const;

export type StepName = (typeof STEP_NAMES)[number];
export const INTAKE_STEP_NAMES: StepName[] = ["extract", "transcribe", "analyze"];

// The gated workflow nodes are driven by explicit APIs instead of the legacy
// automatic runner, so they remain optional for legacy completion checks.
export const OPTIONAL_STEPS: StepName[] = [
  "topic_discovery",
  "text_compliance",
  "voice_timeline",
  "media_compliance",
  "draft_upload",
  "publication",
  "analytics",
];

export const STEP_DEPS: Record<StepName, StepName[]> = {
  extract: [],
  transcribe: ["extract"],
  analyze: ["transcribe"],
  rewrite: ["transcribe"],
  tts: ["rewrite"],
  subtitle: ["tts"],
  images: ["rewrite"],
  render: ["subtitle", "tts", "extract", "images"],
  topic_discovery: [],
  text_compliance: ["rewrite"],
  voice_timeline: ["text_compliance"],
  media_compliance: ["render"],
  draft_upload: ["media_compliance"],
  publication: ["draft_upload"],
  analytics: ["publication"],
};

export const STEP_LABELS: Record<StepName, string> = {
  extract: "采集",
  transcribe: "转写与清洗",
  analyze: "图书与爆款分析",
  rewrite: "二创文案",
  tts: "TTS 配音",
  subtitle: "字幕对齐",
  images: "配图",
  render: "成片导出",
  topic_discovery: "G00 微信读书主动选题",
  text_compliance: "C01 文案合规初审",
  voice_timeline: "V01 提前配音与真实时间轴",
  media_compliance: "C02 发布前完整审核",
  draft_upload: "G07 视频号草稿箱",
  publication: "G08 人工发布确认",
  analytics: "G09 发布数据复盘",
};

export function downstreamOf(name: StepName): StepName[] {
  const result: StepName[] = [];
  const visit = (current: StepName) => {
    for (const step of STEP_NAMES) {
      if (STEP_DEPS[step].includes(current) && !result.includes(step)) {
        result.push(step);
        visit(step);
      }
    }
  };
  visit(name);
  return result;
}
