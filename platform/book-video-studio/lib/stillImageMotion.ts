import crypto from "node:crypto";

export const STILL_IMAGE_MOTIONS = [
  "zoom-out",
  "zoom-in",
  "pan-left-to-right",
  "pan-right-to-left",
] as const;

export type StillImageMotion = (typeof STILL_IMAGE_MOTIONS)[number];

export type StillImageMotionOptions = {
  width: number;
  height: number;
  duration: number;
  fps?: number;
  supersample?: number;
};

function deterministicIndex(value: string, size: number): number {
  const digest = crypto.createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0) % size;
}

/**
 * Assigns reproducible pseudo-random motion while excluding the immediately
 * previous choice. Re-rendering the same storyboard therefore stays stable.
 */
export function assignStillImageMotions(
  slideKeys: string[],
  seed = "wechat-book-video-motion-v1",
): StillImageMotion[] {
  let previous: StillImageMotion | null = null;
  return slideKeys.map((key, index) => {
    const choices = previous
      ? STILL_IMAGE_MOTIONS.filter((motion) => motion !== previous)
      : [...STILL_IMAGE_MOTIONS];
    const selected = choices[deterministicIndex(`${seed}|${index}|${key}`, choices.length)];
    previous = selected;
    return selected;
  });
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Builds one and only one visible motion for a still image. Pans use a fixed
 * 120% scale only to preserve edge coverage; zooms remain centered and never
 * translate. Motion is calculated on a 2x canvas before the final downscale.
 */
export function stillImageMotionFilter(
  motion: StillImageMotion,
  options: StillImageMotionOptions,
): string {
  const fps = Math.max(1, Math.round(options.fps || 60));
  const supersample = Math.max(2, Math.round(options.supersample || 2));
  const width = even(options.width);
  const height = even(options.height);
  const workWidth = even(width * supersample);
  const workHeight = even(height * supersample);
  const maxWidth = even(workWidth * 1.2);
  const maxHeight = even(workHeight * 1.2);
  const deltaWidth = maxWidth - workWidth;
  const deltaHeight = maxHeight - workHeight;
  const frames = Math.max(2, Math.round(Math.max(0.05, options.duration) * fps));
  const progress = `(n/${frames - 1})`;
  const ease = `(${progress}*${progress}*(3-2*${progress}))`;
  const base = [
    `fps=${fps}`,
    `scale=${workWidth}:${workHeight}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${workWidth}:${workHeight}`,
  ];

  if (motion === "zoom-out") {
    base.push(
      `scale=w='ceil((${maxWidth}-${deltaWidth}*${ease})/2)*2':h='ceil((${maxHeight}-${deltaHeight}*${ease})/2)*2':eval=frame:flags=lanczos`,
      `crop=${workWidth}:${workHeight}:x='(iw-${workWidth})/2':y='(ih-${workHeight})/2'`,
    );
  } else if (motion === "zoom-in") {
    base.push(
      `scale=w='ceil((${workWidth}+${deltaWidth}*${ease})/2)*2':h='ceil((${workHeight}+${deltaHeight}*${ease})/2)*2':eval=frame:flags=lanczos`,
      `crop=${workWidth}:${workHeight}:x='(iw-${workWidth})/2':y='(ih-${workHeight})/2'`,
    );
  } else {
    const x = motion === "pan-left-to-right"
      ? `${deltaWidth}*(1-${ease})`
      : `${deltaWidth}*${ease}`;
    base.push(
      `scale=${maxWidth}:${maxHeight}:flags=lanczos`,
      `crop=${workWidth}:${workHeight}:x='${x}':y=${Math.round(deltaHeight / 2)}`,
    );
  }

  base.push(
    `scale=${width}:${height}:flags=lanczos`,
    "setsar=1",
    `trim=end_frame=${frames}`,
    "setpts=PTS-STARTPTS",
  );
  return base.join(",");
}
