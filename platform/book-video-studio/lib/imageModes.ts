export type ImageMode = "square" | "wide";

export type ImageModeConfig = {
  label: string;
  hint: string;
  aspectRatio: "1:1" | "16:9";
  gridAspectRatio: string;
  cellAspectRatio: string;
  highGridImageSize: string;
  imageSize: string;
  outputWidth: number;
  outputHeight: number;
};

export const IMAGE_MODE_CONFIG: Record<ImageMode, ImageModeConfig> = {
  square: {
    label: "方图模式",
    hint: "九宫格总图和单图都以 1:1 为主，高规格九宫格使用 4k 总图",
    aspectRatio: "1:1",
    gridAspectRatio: "1:1 方形画布",
    cellAspectRatio: "1:1 方形构图",
    highGridImageSize: "4096x4096",
    imageSize: "1024x1024",
    outputWidth: 1080,
    outputHeight: 1080,
  },
  wide: {
    label: "横图模式",
    hint: "九宫格总图和单图都以 16:9 为主，更适合电脑端和横向复用",
    aspectRatio: "16:9",
    gridAspectRatio: "16:9 横版画布",
    cellAspectRatio: "16:9 横版构图",
    highGridImageSize: "5760x3240",
    imageSize: "1792x1024",
    outputWidth: 1920,
    outputHeight: 1080,
  },
};

export const IMAGE_MODE_OPTIONS = [
  {
    id: "square",
    label: IMAGE_MODE_CONFIG.square.label,
    hint: IMAGE_MODE_CONFIG.square.hint,
    imageSize: IMAGE_MODE_CONFIG.square.imageSize,
    highGridImageSize: IMAGE_MODE_CONFIG.square.highGridImageSize,
  },
  {
    id: "wide",
    label: IMAGE_MODE_CONFIG.wide.label,
    hint: IMAGE_MODE_CONFIG.wide.hint,
    imageSize: IMAGE_MODE_CONFIG.wide.imageSize,
    highGridImageSize: IMAGE_MODE_CONFIG.wide.highGridImageSize,
  },
] as const;

export function normalizeImageMode(value: unknown): ImageMode {
  return value === "wide" ? "wide" : "square";
}

export function getImageModeConfig(value: unknown): { mode: ImageMode; config: ImageModeConfig } {
  const mode = normalizeImageMode(value);
  return { mode, config: IMAGE_MODE_CONFIG[mode] };
}
