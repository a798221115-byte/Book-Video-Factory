export type ImageStyle = "photo" | "illustration" | "oil_painting" | "watercolor" | "film";

export type ImageStyleConfig = {
  label: string;
  hint: string;
  styleBible: string;
  promptLine: string;
};

export const IMAGE_STYLE_CONFIG: Record<ImageStyle, ImageStyleConfig> = {
  photo: {
    label: "明亮摄影",
    hint: "真实日间生活摄影，适合默认图书口播背景",
    styleBible: `固定美术方向：高调明亮的日间生活摄影，安静、克制、有知识短视频质感。
固定色彩：暖白、浅木色、柔和米白、淡绿色，少量温暖阳光点缀，整体清爽通透。
固定光线：上午或午后窗边自然光，阴影很浅，整体曝光明亮，不要低调暗光、夜景、强暗角或压抑色调。
固定镜头：35mm/50mm 人文镜头语言，主体明确，背景简洁。
人物气质：普通成年人，安静、理性、克制，优先背影、侧影、手部动作和生活场景。
所有图片必须共享同一套色彩、光线、镜头、人物气质、材质和时代感。`,
    promptLine: "高调明亮日光感，真实摄影风，光线自然充足，画面干净，低信息密度。",
  },
  illustration: {
    label: "高级插画",
    hint: "干净克制的商业插画，人物和物件更稳定",
    styleBible: `固定美术方向：高级商业插画风，明亮、克制、生活化，有知识短视频质感。
固定色彩：暖白、浅木色、柔和米白、淡绿色，少量温暖阳光点缀，整体清爽通透。
固定光线：上午或午后窗边自然光感，阴影很浅，整体曝光明亮，不要低调暗光、夜景、强暗角或压抑色调。
固定画法：柔和边缘、细腻材质、低信息密度，避免卡通夸张、漫画分镜和厚重描边。
人物气质：普通成年人，安静、理性、克制，优先背影、侧影、手部动作和生活场景。
所有图片必须共享同一套色彩、光线、画法、人物气质、材质和时代感。`,
    promptLine: "高级商业插画风，明亮自然光，柔和边缘，细腻材质，低信息密度。",
  },
  oil_painting: {
    label: "温暖油画",
    hint: "油画笔触和布面质感，适合更有情绪的读书分镜",
    styleBible: `固定美术方向：明亮温暖的现代油画风，安静、克制、有图书短视频质感。
固定色彩：暖白、浅木色、柔和米白、淡绿色和少量金色阳光，整体清爽通透，不要厚重暗沉。
固定光线：上午或午后窗边自然光，阴影很浅，整体曝光明亮，不要低调暗光、夜景、强暗角或压抑色调。
固定画法：可见但克制的油画笔触、细腻布面纹理、柔和色块过渡，避免脏污、龟裂、复古暗棕和博物馆暗光。
人物气质：普通成年人，安静、理性、克制，优先背影、侧影、手部动作和生活场景。
所有图片必须共享同一套色彩、光线、油画笔触、人物气质、材质和时代感。`,
    promptLine: "明亮温暖的现代油画风，可见但克制的油画笔触，细腻布面纹理，柔和自然光，整体清爽不暗沉。",
  },
  watercolor: {
    label: "水彩绘本",
    hint: "轻盈水彩纸感，更柔和、治愈",
    styleBible: `固定美术方向：明亮轻盈的水彩绘本风，安静、克制、生活化，有知识短视频质感。
固定色彩：暖白、浅木色、柔和米白、淡绿色，少量温暖阳光点缀，整体清爽通透。
固定光线：上午或午后窗边自然光感，阴影很浅，整体曝光明亮，不要低调暗光、夜景、强暗角或压抑色调。
固定画法：透明水彩晕染、轻微纸张纹理、干净留白，避免低幼卡通、漫画线框和过饱和色块。
人物气质：普通成年人，安静、理性、克制，优先背影、侧影、手部动作和生活场景。
所有图片必须共享同一套色彩、光线、水彩质感、人物气质、材质和时代感。`,
    promptLine: "明亮轻盈的水彩绘本风，透明水彩晕染，轻微纸张纹理，干净留白。",
  },
  film: {
    label: "清透胶片",
    hint: "轻胶片颗粒和暖色日光，保留真实感",
    styleBible: `固定美术方向：清透明亮的日间胶片摄影风，安静、克制、有知识短视频质感。
固定色彩：暖白、浅木色、柔和米白、淡绿色，轻微胶片暖调，整体清爽通透。
固定光线：上午或午后窗边自然光，阴影很浅，整体曝光明亮，不要低调暗光、夜景、强暗角或压抑色调。
固定镜头：35mm/50mm 人文镜头语言，轻微胶片颗粒，主体明确，背景简洁。
人物气质：普通成年人，安静、理性、克制，优先背影、侧影、手部动作和生活场景。
所有图片必须共享同一套色彩、光线、胶片质感、人物气质、材质和时代感。`,
    promptLine: "清透明亮的日间胶片摄影风，轻微胶片颗粒，暖色自然光，画面干净。",
  },
};

export const IMAGE_STYLE_OPTIONS = [
  { id: "photo", label: IMAGE_STYLE_CONFIG.photo.label, hint: IMAGE_STYLE_CONFIG.photo.hint },
  { id: "illustration", label: IMAGE_STYLE_CONFIG.illustration.label, hint: IMAGE_STYLE_CONFIG.illustration.hint },
  { id: "oil_painting", label: IMAGE_STYLE_CONFIG.oil_painting.label, hint: IMAGE_STYLE_CONFIG.oil_painting.hint },
  { id: "watercolor", label: IMAGE_STYLE_CONFIG.watercolor.label, hint: IMAGE_STYLE_CONFIG.watercolor.hint },
  { id: "film", label: IMAGE_STYLE_CONFIG.film.label, hint: IMAGE_STYLE_CONFIG.film.hint },
] as const;

export function normalizeImageStyle(value: unknown): ImageStyle {
  return typeof value === "string" && value in IMAGE_STYLE_CONFIG ? value as ImageStyle : "photo";
}

export function getImageStyleConfig(value: unknown): { style: ImageStyle; config: ImageStyleConfig } {
  const style = normalizeImageStyle(value);
  return { style, config: IMAGE_STYLE_CONFIG[style] };
}
