import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const taskId = process.argv[2] || "MW4GhE1OqNnO";
const requestedDuration = Number(process.argv[3] || 12);
const duration = Number.isFinite(requestedDuration)
  ? Math.max(6, Math.min(30, requestedDuration))
  : 12;
const fps = 30;
const taskDir = path.join(root, "data", "tasks", taskId);
const outDir = path.join(root, "public", "motion-previews");
const ffmpeg = process.env.FFMPEG_BIN?.trim() || "ffmpeg";

const profiles = [
  {
    id: "cinematic",
    label: "电影感慢推",
    description: "缓慢推进并沿对角线移动，使用柔和交叉淡化。",
    zoom: 0.08,
    transition: "fade",
    fade: 0.55,
    grade: "eq=brightness=0.015:contrast=1.02:saturation=1.02:gamma=1.03,vignette=angle=PI/5",
    paths: ["left-up", "right-down", "right-up", "left-down"],
  },
  {
    id: "quick",
    label: "动感快切",
    description: "更明显的推进和横向位移，使用短促擦切。",
    zoom: 0.14,
    transition: "wipeleft",
    fade: 0.18,
    grade: "unsharp=5:5:0.45:3:3:0,eq=brightness=0.012:contrast=1.08:saturation=1.1",
    paths: ["left", "right", "left", "right"],
  },
  {
    id: "calm",
    label: "静帧轻放大",
    description: "主体始终居中，仅做克制的呼吸式放大和长溶解。",
    zoom: 0.045,
    transition: "fade",
    fade: 0.85,
    grade: "eq=brightness=0.018:contrast=0.97:saturation=0.88:gamma=1.025",
    paths: ["center", "center", "center", "center"],
  },
  {
    id: "collage",
    label: "胶片横移",
    description: "横向画框切换，配合低饱和、暗角和轻颗粒。",
    zoom: 0.075,
    transition: "slideleft",
    fade: 0.38,
    grade: "colorchannelmixer=.88:.08:.04:0:.06:.86:.08:0:.04:.12:.8:0,eq=contrast=1.07:saturation=0.76:gamma=1.04,vignette=angle=PI/4,noise=alls=5:allf=t+u",
    paths: ["right", "left", "right", "left"],
  },
];

function imageSort(a, b) {
  const ax = a.match(/^img_(\d+)_(\d+)\.(?:jpe?g|png)$/i)?.slice(1).map(Number) || [0, 0];
  const bx = b.match(/^img_(\d+)_(\d+)\.(?:jpe?g|png)$/i)?.slice(1).map(Number) || [0, 0];
  return ax[0] - bx[0] || ax[1] - bx[1];
}

function pickRepresentativeImages(count = 4) {
  const candidates = fs.readdirSync(taskDir)
    .filter((file) => /^img_\d+_\d+\.(?:jpe?g|png)$/i.test(file))
    .sort(imageSort);
  const groups = new Map();
  for (const file of candidates) {
    const group = file.match(/^img_(\d+)_/i)?.[1] || "0";
    const values = groups.get(group) || [];
    values.push(file);
    groups.set(group, values);
  }

  const picked = [];
  for (const files of groups.values()) {
    picked.push(files[Math.floor(files.length / 2)]);
    if (picked.length === count) break;
  }
  for (const file of candidates) {
    if (picked.length === count) break;
    if (!picked.includes(file)) picked.push(file);
  }
  return picked.map((file) => path.join(taskDir, file));
}

function motionExpressions(kind, frames, zoomAmount) {
  const progress = `min(on/${Math.max(1, frames - 1)},1)`;
  const zoom = `1+${zoomAmount.toFixed(4)}*${progress}`;
  const centerX = "(iw-iw/zoom)/2";
  const centerY = "(ih-ih/zoom)/2";
  const leftX = `(iw-iw/zoom)*0.12`;
  const rightX = `(iw-iw/zoom)*0.88`;
  const topY = `(ih-ih/zoom)*0.18`;
  const bottomY = `(ih-ih/zoom)*0.82`;

  if (kind === "left") return { zoom, x: leftX, y: centerY };
  if (kind === "right") return { zoom, x: rightX, y: centerY };
  if (kind === "left-up") return { zoom, x: leftX, y: topY };
  if (kind === "right-up") return { zoom, x: rightX, y: topY };
  if (kind === "left-down") return { zoom, x: leftX, y: bottomY };
  if (kind === "right-down") return { zoom, x: rightX, y: bottomY };
  return { zoom, x: centerX, y: centerY };
}

function renderProfile(profile, images, audioPath) {
  const fade = profile.fade;
  const clipDuration = (duration + fade * (images.length - 1)) / images.length;
  const frames = Math.ceil(clipDuration * fps);
  const args = ["-y", "-hide_banner", "-loglevel", "warning"];

  for (const image of images) {
    args.push("-loop", "1", "-framerate", String(fps), "-t", clipDuration.toFixed(3), "-i", image);
  }

  const audioIndex = images.length;
  if (audioPath) {
    args.push("-i", audioPath);
  } else {
    args.push("-f", "lavfi", "-t", String(duration), "-i", "anullsrc=r=48000:cl=stereo");
  }

  const filters = [];
  for (let i = 0; i < images.length; i += 1) {
    const motion = motionExpressions(profile.paths[i % profile.paths.length], frames, profile.zoom);
    filters.push(
      `[${i}:v]split=2[bg${i}][fg${i}]`,
      `[bg${i}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=28,eq=brightness=-0.25:saturation=0.82[bgv${i}]`,
      `[fg${i}]scale=920:920:force_original_aspect_ratio=decrease,pad=920:920:(ow-iw)/2:(oh-ih)/2:color=0x101010[fgv${i}]`,
      `[bgv${i}][fgv${i}]overlay=(W-w)/2:(H-h)/2,drawbox=x=78:y=498:w=924:h=924:color=white@0.17:t=2,${profile.grade},zoompan=z='${motion.zoom}':x='${motion.x}':y='${motion.y}':d=1:s=1080x1920:fps=${fps},setpts=PTS-STARTPTS[v${i}]`,
    );
  }

  let current = "v0";
  for (let i = 1; i < images.length; i += 1) {
    const next = `xf${i}`;
    const offset = i * (clipDuration - fade);
    filters.push(
      `[${current}][v${i}]xfade=transition=${profile.transition}:duration=${fade.toFixed(3)}:offset=${offset.toFixed(3)}[${next}]`,
    );
    current = next;
  }
  filters.push(`[${current}]trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS[outv]`);

  const output = path.join(outDir, `${profile.id}.mp4`);
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[outv]", "-map", `${audioIndex}:a:0`,
    "-t", duration.toFixed(3),
    "-af", `afade=t=in:st=0:d=0.2,afade=t=out:st=${Math.max(0, duration - 0.35).toFixed(3)}:d=0.35`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
    "-movflags", "+faststart", "-shortest", output,
  );

  console.log(`[motion-preview] rendering ${profile.id}`);
  execFileSync(ffmpeg, args, { stdio: "inherit", maxBuffer: 1024 * 1024 * 64 });

  const poster = path.join(outDir, `${profile.id}.jpg`);
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", "2.2", "-i", output, "-frames:v", "1", "-q:v", "2", poster,
  ], { stdio: "inherit" });

  return {
    id: profile.id,
    label: profile.label,
    description: profile.description,
    video: `/motion-previews/${profile.id}.mp4`,
    poster: `/motion-previews/${profile.id}.jpg`,
  };
}

if (!fs.existsSync(taskDir)) throw new Error(`Task directory not found: ${taskDir}`);
const images = pickRepresentativeImages(4);
if (images.length < 4) throw new Error(`Task ${taskId} needs at least four generated images`);
const audioPath = fs.existsSync(path.join(taskDir, "tts.wav")) ? path.join(taskDir, "tts.wav") : null;

fs.mkdirSync(outDir, { recursive: true });
const outputs = profiles.map((profile) => renderProfile(profile, images, audioPath));
const manifest = {
  generatedAt: new Date().toISOString(),
  taskId,
  duration,
  fps,
  resolution: "1080x1920",
  sourceImages: images.map((file) => path.relative(root, file)),
  outputs,
};
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
console.log(`[motion-preview] done: ${path.join(root, "public", "motion-previews.html")}`);
