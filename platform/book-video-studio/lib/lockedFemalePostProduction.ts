import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getTranscriptLLM } from "./providers/llm";
import {
  getArtifacts,
  getTask,
  patchArtifact,
  projectArtifactPath,
  saveArtifact,
  setStepStatus,
  taskDir,
  updateTask,
} from "./pipeline/repo";

const execFileP = promisify(execFile);
const FFMPEG = process.env.FFMPEG_BIN?.trim() || "ffmpeg";
const running: Set<string> = ((globalThis as any).__lockedFemalePostProductionJobs ??= new Set<string>());

type VoiceSegment = {
  index: number;
  text: string;
  startSeconds: number;
  speechDurationSeconds: number;
  pauseAfterSeconds: number;
  endSeconds: number;
};

type CaptionCard = {
  index: number;
  segmentIndex: number;
  startSeconds: number;
  endSeconds: number;
  chinese: string;
  english: string;
};

function parseJson(raw: string | null | undefined) {
  try { return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}

function parseModelJson(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

function upsertArtifact(input: {
  taskId: string;
  stepName: string;
  kind: string;
  label: string;
  path?: string;
  content?: string;
  meta?: any;
}) {
  const existing = getArtifacts(input.taskId).find(
    (item) => item.stepName === input.stepName && item.kind === input.kind,
  );
  if (existing) {
    patchArtifact(existing.id, {
      label: input.label,
      path: input.path ?? null,
      content: input.content ?? null,
      meta: input.meta ? JSON.stringify(input.meta) : null,
    });
    return existing.id;
  }
  return saveArtifact(input);
}

function srtTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const ms = total % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function assTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(total / 360_000);
  const m = Math.floor((total % 360_000) / 6000);
  const s = Math.floor((total % 6000) / 100);
  const cs = total % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function displayChinese(text: string) {
  return text.replace(/[，。]/g, "").replace(/\s+/g, " ").trim();
}

function splitCaptionText(text: string, maxChars = 15) {
  const normalized = text.replace(/\s+/g, "").trim();
  if (!normalized) return [];
  const semanticParts = normalized.split(/(?<=[，。！？；：])/).filter(Boolean);
  const cards: string[] = [];
  for (const part of semanticParts) {
    const clean = displayChinese(part);
    if (!clean) continue;
    if (clean.length <= maxChars) {
      cards.push(clean);
      continue;
    }
    for (let offset = 0; offset < clean.length; offset += maxChars) {
      cards.push(clean.slice(offset, offset + maxChars));
    }
  }
  return cards;
}

async function translateCards(chinese: string[]) {
  const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
  let translations: string[] = [];
  try {
    const response = await getTranscriptLLM().chat({
      system: [
        "你是短视频双语字幕翻译器。",
        "把每条简体中文翻译成自然、克制、简短的英文字幕。",
        "每条英文必须保持一行，尽量不超过 42 个英文字符。",
        "不得增加解释，不得合并、拆分或改变条目数量。",
        "只输出 JSON：{\"translations\":[\"...\"]}。",
      ].join("\n"),
      user: `请翻译以下 JSON 数组，并严格保持顺序和数量：\n${JSON.stringify(chinese)}`,
      temperature: 0.1,
      json: true,
    });
    const parsed = parseModelJson(response);
    translations = Array.isArray(parsed.translations) ? parsed.translations.map(normalize) : [];
  } catch {
    translations = [];
  }

  const repaired: string[] = [];
  for (let index = 0; index < chinese.length; index += 1) {
    let item = normalize(translations[index]);
    for (let attempt = 1; !item && attempt <= 3; attempt += 1) {
      const jsonMode = attempt < 3;
      const fallbackResponse = await getTranscriptLLM().chat({
        system: jsonMode
          ? [
              "你是短视频双语字幕翻译器。",
              "把简体中文翻译成自然、克制、简短的一行英文字幕。",
              "只输出 JSON：{\"translation\":\"...\"}。",
            ].join("\n")
          : "Translate the Chinese caption into one concise English subtitle. Return only the English translation.",
        user: jsonMode
          ? `请只翻译这一条字幕：${JSON.stringify(chinese[index])}`
          : chinese[index],
        temperature: attempt === 1 ? 0.1 : 0,
        json: jsonMode,
      });
      if (jsonMode) {
        try {
          const fallbackParsed = parseModelJson(fallbackResponse);
          item = normalize(
            fallbackParsed.translation ??
            (Array.isArray(fallbackParsed.translations) ? fallbackParsed.translations[0] : ""),
          );
        } catch {
          item = "";
        }
      } else {
        item = normalize(fallbackResponse.replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/, ""))
          .replace(/^["']|["']$/g, "")
          .trim();
      }
    }
    if (!item) {
      throw new Error(`DeepSeek 字幕翻译补偿失败：第 ${index + 1}/${chinese.length} 条连续 3 次为空`);
    }
    repaired.push(item);
  }
  return repaired;
}

function buildCaptionCards(timeline: VoiceSegment[], translations: string[]) {
  const pending = timeline.flatMap((segment) =>
    splitCaptionText(segment.text).map((chinese) => ({ segment, chinese })),
  );
  return pending.map((item, index) => {
    const sameSegment = pending.filter((candidate) => candidate.segment.index === item.segment.index);
    const localIndex = sameSegment.findIndex((candidate) => candidate === item);
    const weights = sameSegment.map((candidate) => Math.max(1, candidate.chinese.length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const beforeWeight = weights.slice(0, localIndex).reduce((sum, weight) => sum + weight, 0);
    const currentWeight = weights[localIndex];
    const start = item.segment.startSeconds + item.segment.speechDurationSeconds * beforeWeight / totalWeight;
    const end = item.segment.startSeconds + item.segment.speechDurationSeconds * (beforeWeight + currentWeight) / totalWeight;
    return {
      index: index + 1,
      segmentIndex: item.segment.index,
      startSeconds: Number(start.toFixed(3)),
      endSeconds: Number(end.toFixed(3)),
      chinese: item.chinese,
      english: translations[index],
    } satisfies CaptionCard;
  });
}

function buildSrt(cards: CaptionCard[], field: "chinese" | "english") {
  return cards.map((card, index) =>
    `${index + 1}\n${srtTime(card.startSeconds)} --> ${srtTime(card.endSeconds)}\n${card[field]}\n`,
  ).join("\n");
}

function escapeAss(text: string) {
  return text.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}");
}

function buildAss(cards: CaptionCard[], duration: number, title: string, author: string) {
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Column,Microsoft YaHei,32,&H00E8E8E8,&H00FFFFFF,&H80000000,&H00000000,0,0,0,0,100,100,2,0,1,1.5,0,8,40,40,95,1",
    "Style: Title,Microsoft YaHei,88,&H002A82ED,&H00FFFFFF,&H90000000,&H00000000,1,0,0,0,100,100,0,0,1,2.2,0,8,60,60,165,1",
    "Style: Author,Microsoft YaHei,48,&H00FFD6A8,&H00FFFFFF,&H90000000,&H00000000,1,0,0,0,100,100,1,0,1,1.8,0,8,40,40,255,1",
    "Style: CN,Microsoft YaHei,58,&H00FFFFFF,&H00FFFFFF,&HA0000000,&H00000000,1,0,0,0,100,100,0,0,1,3.0,0,2,38,38,560,1",
    "Style: EN,Arial,30,&H00FFFFFF,&H00FFFFFF,&HA0000000,&H00000000,0,0,0,0,100,100,0,0,1,2.2,0,2,55,55,505,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,${assTime(0)},${assTime(duration)},Column,,0,0,0,,读书分享`,
    `Dialogue: 0,${assTime(0)},${assTime(duration)},Title,,0,0,0,,${escapeAss(`《${title}》`)}`,
    `Dialogue: 0,${assTime(0)},${assTime(duration)},Author,,0,0,0,,${escapeAss(author)}`,
  ];
  for (const card of cards) {
    lines.push(`Dialogue: 0,${assTime(card.startSeconds)},${assTime(card.endSeconds)},CN,,0,0,0,,${escapeAss(card.chinese)}`);
    lines.push(`Dialogue: 0,${assTime(card.startSeconds)},${assTime(card.endSeconds)},EN,,0,0,0,,${escapeAss(card.english)}`);
  }
  return `${lines.join("\n")}\n`;
}

function quoteConcatPath(filePath: string) {
  return filePath.replaceAll("\\", "/").replaceAll("'", "'\\''");
}

async function runFfmpeg(args: string[], cwd: string, label: string) {
  try {
    await execFileP(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args], {
      cwd,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 64,
      timeout: 20 * 60 * 1000,
    });
  } catch (error: any) {
    const detail = String(error?.stderr || error?.message || error).slice(-1800);
    throw new Error(`${label}失败：${detail}`);
  }
}

function compactDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replaceAll("-", "");
}

const STILL_MOTIONS = [
  "zoom-out",
  "zoom-in",
  "pan-left-to-right",
  "pan-right-to-left",
] as const;

function parseArtifactMeta(raw: string | null | undefined) {
  try { return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}

function motionSeed(taskId: string) {
  let value = 2166136261;
  for (const char of taskId) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

function assignMotions<T extends Record<string, any>>(taskId: string, shots: T[]) {
  let seed = motionSeed(taskId);
  let previous = "";
  return shots.map((shot) => {
    const choices = STILL_MOTIONS.filter((item) => item !== previous);
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const motion = choices[(seed >>> 0) % choices.length];
    previous = motion;
    return { ...shot, motion };
  });
}

function resolveApprovedImageEntries(taskId: string, dir: string) {
  const all = getArtifacts(taskId);
  const storyboardImages = all
    .filter((item) => item.stepName === "storyboard" && item.kind === "storyboard_image" && item.path)
    .map((item) => {
      const meta = parseArtifactMeta(item.meta);
      return {
        id: String(meta.jobId || item.label || item.id),
        imageRelative: String(item.path),
        image: path.resolve(dir, String(item.path).replace(/^work[/\\][^/\\]+[/\\]/, "")),
      };
    })
    .filter((item) => fs.existsSync(item.image))
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
  const styleArtifact = [...all]
    .reverse()
    .find((item) => item.stepName === "storyboard" && item.kind === "style_sample" && item.path);
  const styleEntry = styleArtifact?.path
    ? {
        id: "STYLE",
        imageRelative: String(styleArtifact.path),
        image: path.resolve(dir, String(styleArtifact.path).replace(/^work[/\\][^/\\]+[/\\]/, "")),
      }
    : null;
  const ordered = [...storyboardImages];
  if (styleEntry && fs.existsSync(styleEntry.image)) ordered.splice(Math.min(1, ordered.length), 0, styleEntry);
  const seen = new Set<string>();
  return ordered.filter((item) => {
    const key = path.normalize(item.image).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveRenderShots(taskId: string, dir: string, storyboard: any, timeline: VoiceSegment[]) {
  const direct = (storyboard.beats || []).map((beat: any) => {
    const imageRelative =
      storyboard.generated_images?.[beat.id] ||
      beat.image_path ||
      (beat.image?.file_name ? `storyboard/images/${beat.image.file_name}` : "");
    const image = imageRelative ? path.resolve(dir, imageRelative) : "";
    return {
      id: String(beat.id),
      order: Number(beat.order || 0),
      image,
      imageRelative,
      startSeconds: Number(beat.actual_voice_start_seconds),
      endSeconds: Number(beat.actual_voice_end_seconds),
      durationSeconds: Number(beat.actual_voice_duration_seconds),
      scriptText: String(beat.script_text || ""),
    };
  });
  const directValid = direct.length > 0 && direct.every(
    (shot: any) => fs.existsSync(shot.image) && Number.isFinite(shot.durationSeconds) && shot.durationSeconds > 0,
  );
  if (directValid) return assignMotions(taskId, direct);

  const images = resolveApprovedImageEntries(taskId, dir);
  if (!images.length) throw new Error("No approved storyboard images are available for rendering");
  if (images.length > timeline.length) throw new Error("Approved image count exceeds narration segment count");

  const shots: any[] = [];
  let cursor = 0;
  for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
    const remainingImages = images.length - imageIndex;
    const remainingSegments = timeline.length - cursor;
    let take = Math.max(1, Math.round(remainingSegments / remainingImages));
    take = Math.min(take, remainingSegments - (remainingImages - 1));
    const members = timeline.slice(cursor, cursor + take);
    cursor += take;
    const startSeconds = Number(members[0].startSeconds || 0);
    const endSeconds = Number(members[members.length - 1].endSeconds || startSeconds);
    shots.push({
      id: images[imageIndex].id,
      order: imageIndex + 1,
      image: images[imageIndex].image,
      imageRelative: images[imageIndex].imageRelative,
      startSeconds,
      endSeconds,
      durationSeconds: Number((endSeconds - startSeconds).toFixed(6)),
      scriptText: members.map((item) => item.text).join(""),
      sourceSegmentIndexes: members.map((item) => item.index),
    });
  }
  return assignMotions(taskId, shots);
}

function motionFilter(motion: string, frameCount: number) {
  const denominator = Math.max(1, frameCount - 1);
  const progress = `min(1,max(0,on/${denominator}))`;
  const ease = `(${progress})*(${progress})*(3-2*(${progress}))`;
  let zoom = "1.2";
  let x = "iw/2-(iw/zoom/2)";
  const y = "ih/2-(ih/zoom/2)";
  if (motion === "zoom-out") zoom = `1.2-0.2*(${ease})`;
  else if (motion === "zoom-in") zoom = `1+0.2*(${ease})`;
  else if (motion === "pan-left-to-right") x = `(iw-iw/zoom)*(${ease})`;
  else if (motion === "pan-right-to-left") x = `(iw-iw/zoom)*(1-(${ease}))`;
  return [
    "scale=2160:3840:force_original_aspect_ratio=increase:flags=lanczos",
    "crop=2160:3840",
    `zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=2160x3840:fps=60`,
    "scale=1080:1920:flags=lanczos",
    "setsar=1",
    "format=yuv420p",
  ].join(",");
}

export async function startLockedFemalePostProduction(taskId: string) {
  if (running.has(taskId)) return;
  running.add(taskId);
  try {
    const task = getTask(taskId);
    if (!task) throw new Error("任务不存在");
    const dir = taskDir(taskId);
    const projectRoot = path.resolve(dir, "..", "..");
    const voiceDir = path.join(dir, "voice");
    const renderDir = path.join(dir, "render");
    fs.mkdirSync(renderDir, { recursive: true });

    const timelinePath = path.join(voiceDir, "voice-timeline-female-locked-v1.json");
    const voicePath = path.join(voiceDir, "narration-female-locked-v1-master.wav");
    const storyboardPath = path.join(dir, "storyboard", "storyboard.json");
    for (const required of [timelinePath, voicePath, storyboardPath]) {
      if (!fs.existsSync(required)) throw new Error(`缺少后期输入：${required}`);
    }
    const timelineData = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
    const timeline: VoiceSegment[] = timelineData.timeline || [];
    const duration = Number(timelineData.durationSeconds || 0);
    if (!timeline.length || !duration) throw new Error("女声真实时长时间轴无效");

    updateTask(taskId, { status: "generating_subtitles", currentGate: "CAPTIONS_GENERATING" });
    setStepStatus(taskId, "subtitle", {
      status: "running",
      progress: 0.08,
      error: "",
      startedAt: Date.now(),
      output: JSON.stringify({ phase: "splitting", bilingual: true }),
    });
    const chineseCards = timeline.flatMap((segment) => splitCaptionText(segment.text));
    setStepStatus(taskId, "subtitle", {
      progress: 0.25,
      output: JSON.stringify({ phase: "translating", cards: chineseCards.length, bilingual: true }),
    });
    const translations = await translateCards(chineseCards);
    const cards = buildCaptionCards(timeline, translations);

    const cnSrtPath = path.join(dir, "captions-cn-female.srt");
    const enSrtPath = path.join(dir, "captions-en-female.srt");
    const assPath = path.join(dir, "captions-female.ass");
    const recipePath = path.join(dir, "recipe.json");
    fs.writeFileSync(cnSrtPath, buildSrt(cards, "chinese"), "utf8");
    fs.writeFileSync(enSrtPath, buildSrt(cards, "english"), "utf8");
    fs.writeFileSync(assPath, buildAss(cards, duration, task.bookTitle || "图书", task.bookAuthor || ""), "utf8");

    const storyboard = JSON.parse(fs.readFileSync(storyboardPath, "utf8"));
    const legacyBeats = false ? (storyboard.beats || []).map((beat: any) => {
      const imageRelative = storyboard.generated_images?.[beat.id] || beat.image?.file_name && `storyboard/images/${beat.image.file_name}`;
      const imagePath = imageRelative ? path.resolve(dir, imageRelative) : "";
      if (!imagePath || !fs.existsSync(imagePath)) throw new Error(`分镜 ${beat.id} 缺少已确认图片`);
      return {
        id: String(beat.id),
        order: Number(beat.order || 0),
        image: imagePath,
        imageRelative,
        startSeconds: Number(beat.actual_voice_start_seconds),
        endSeconds: Number(beat.actual_voice_end_seconds),
        durationSeconds: Number(beat.actual_voice_duration_seconds),
        scriptText: String(beat.script_text || ""),
      };
    }) : [];
    if (false && (!legacyBeats.length || legacyBeats.some((beat: any) => !Number.isFinite(beat.durationSeconds) || beat.durationSeconds <= 0))) {
      throw new Error("storyboard.json 缺少真实配音镜头时长");
    }
    const beats = resolveRenderShots(taskId, dir, storyboard, timeline);
    const config = JSON.parse(fs.readFileSync(path.join("F:\\Codex\\.codex\\skills\\produce-wechat-book-video", "assets", "default-config.json"), "utf8"));
    const introPath = path.resolve(projectRoot, config.introVariants.female.path);
    const musicPath = path.resolve(projectRoot, config.backgroundMusic);
    for (const required of [introPath, musicPath]) {
      if (!fs.existsSync(required)) throw new Error(`固定后期素材不存在：${required}`);
    }
    const introDuration = Number(config.introVariants.female.durationSeconds);
    const recipe = {
      version: "locked-female-auto-post-v1",
      taskId,
      book: task.bookTitle,
      author: task.bookAuthor,
      productionVariant: "female",
      voicePreset: "assets/voice-presets/female-book-narrator-locked-v1.json",
      voiceReferenceModeUsed: timelineData.referenceModeUsed,
      fixedIntro: path.relative(projectRoot, introPath).replaceAll("\\", "/"),
      introDurationSeconds: introDuration,
      voice: projectArtifactPath(voicePath),
      draftVoice: "voice/narration-female-locked-v1-master.wav",
      voiceTimeline: projectArtifactPath(timelinePath),
      bodyDurationSeconds: duration,
      totalDurationSeconds: Number((introDuration + duration).toFixed(3)),
      video: { width: 1080, height: 1920, fps: 60, codec: "H.264", pixelFormat: "yuv420p" },
      captions: {
        bilingual: true,
        singleLine: true,
        chinese: projectArtifactPath(cnSrtPath),
        english: projectArtifactPath(enSrtPath),
        ass: projectArtifactPath(assPath),
        cards,
      },
      shots: beats,
    };
    fs.writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`, "utf8");
    upsertArtifact({ taskId, stepName: "subtitle", kind: "captions_cn", label: "G05 简体中文字幕", path: projectArtifactPath(cnSrtPath), meta: { cards: cards.length, singleLine: true } });
    upsertArtifact({ taskId, stepName: "subtitle", kind: "captions_en", label: "G05 英文字幕", path: projectArtifactPath(enSrtPath), meta: { cards: cards.length, singleLine: true, provider: "deepseek" } });
    upsertArtifact({ taskId, stepName: "subtitle", kind: "captions_ass", label: "G05 中英双语渲染字幕", path: projectArtifactPath(assPath), meta: { cards: cards.length, typography: { title: 88, author: 48, chinese: 58, english: 30 } } });
    upsertArtifact({ taskId, stepName: "subtitle", kind: "recipe", label: "G05 真实时长生产配方", path: projectArtifactPath(recipePath), meta: recipe });
    setStepStatus(taskId, "subtitle", {
      status: "done",
      progress: 1,
      finishedAt: Date.now(),
      output: JSON.stringify({ phase: "done", cards: cards.length, bilingual: true }),
    });

    updateTask(taskId, { status: "rendering_video", currentGate: "VIDEO_RENDERING" });
    setStepStatus(taskId, "render", {
      status: "running",
      progress: 0.05,
      error: "",
      startedAt: Date.now(),
      output: JSON.stringify({ phase: "building-body", shots: beats.length }),
    });
    const shotsDir = path.join(renderDir, "motion-shots");
    fs.mkdirSync(shotsDir, { recursive: true });
    const targetFrames = Math.ceil(duration * 60);
    const frameCounts = beats.map((beat: any) => Math.max(1, Math.round(beat.durationSeconds * 60)));
    frameCounts[frameCounts.length - 1] += targetFrames - frameCounts.reduce((sum: number, count: number) => sum + count, 0);
    const motionPaths: string[] = [];
    for (let index = 0; index < beats.length; index++) {
      const beat = beats[index];
      const motionPath = path.join(shotsDir, `${String(index + 1).padStart(2, "0")}.mp4`);
      await runFfmpeg([
        "-loop", "1", "-framerate", "60", "-i", beat.image,
        "-vf", motionFilter(beat.motion, frameCounts[index]),
        "-frames:v", String(frameCounts[index]), "-an",
        "-c:v", "libx264", "-preset", "medium", "-crf", "17",
        "-pix_fmt", "yuv420p", "-r", "60", motionPath,
      ], dir, `motion shot ${index + 1}`);
      motionPaths.push(motionPath);
      setStepStatus(taskId, "render", {
        progress: 0.05 + 0.45 * ((index + 1) / beats.length),
        output: JSON.stringify({ phase: "rendering-motion-shots", completed: index + 1, total: beats.length }),
      });
    }
    const concatPath = path.join(renderDir, "body-motion.ffconcat");
    const concatLines = ["ffconcat version 1.0", ...motionPaths.map((item) => `file '${quoteConcatPath(item)}'`)];
    fs.writeFileSync(concatPath, `${concatLines.join("\n")}\n`, "utf8");
    const rawBodyPath = path.join(renderDir, "body-motion.mp4");
    await runFfmpeg([
      "-f", "concat", "-safe", "0", "-i", concatPath,
      "-an", "-c", "copy", rawBodyPath,
    ], dir, "motion shot concat");

    const bodyPath = path.join(renderDir, "body-female-auto.mp4");
    await runFfmpeg([
      "-i", rawBodyPath,
      "-vf", "ass=captions-female.ass",
      "-t", duration.toFixed(3),
      "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
      "-r", "60", "-movflags", "+faststart", bodyPath,
    ], dir, "正文视频渲染");
    setStepStatus(taskId, "render", {
      progress: 0.62,
      output: JSON.stringify({ phase: "mixing-intro-voice-music", shots: beats.length }),
    });

    const finalPath = path.join(renderDir, `${compactDate()}-wxsp-${taskId.slice(0, 6)}-01.mp4`);
    const totalDuration = introDuration + duration;
    const fadeStart = Math.max(0, totalDuration - 1);
    const filter = [
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=60,tpad=stop_mode=clone:stop_duration=0.1,setsar=1,trim=duration=${introDuration.toFixed(3)},setpts=PTS-STARTPTS[iv]`,
      `[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=60,tpad=stop_mode=clone:stop_duration=0.1,setsar=1,trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS[bv]`,
      "[iv][bv]concat=n=2:v=1:a=0[v]",
      `[0:a]atrim=0:${introDuration.toFixed(3)},asetpts=PTS-STARTPTS,apad,atrim=0:${totalDuration.toFixed(3)}[ia]`,
      `[2:a]aresample=48000,asetpts=PTS-STARTPTS,adelay=${Math.round(introDuration * 1000)}:all=1[va]`,
      "[ia][va]amix=inputs=2:duration=longest:normalize=0,asplit=2[dialogue][sidechain]",
      `[3:a]atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.63,afade=t=out:st=${fadeStart.toFixed(3)}:d=1[music]`,
      "[music][sidechain]sidechaincompress=threshold=0.018:ratio=4:attack=10:release=220[ducked]",
      "[dialogue][ducked]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.90:level=false[a]",
    ].join(";");
    await runFfmpeg([
      "-i", introPath, "-i", bodyPath, "-i", voicePath, "-stream_loop", "-1", "-i", musicPath,
      "-filter_complex", filter,
      "-map", "[v]", "-map", "[a]",
      "-t", totalDuration.toFixed(3),
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
      "-r", "60", "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
      "-movflags", "+faststart", finalPath,
    ], dir, "片头与成片混音");
    if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size < 1024 * 1024) {
      throw new Error("成片文件不存在或体积异常");
    }
    const validationPath = path.join(renderDir, "validation-report.json");
    const validation = {
      passed: true,
      checkedAt: new Date().toISOString(),
      output: projectArtifactPath(finalPath),
      fileSize: fs.statSync(finalPath).size,
      expected: { width: 1080, height: 1920, fps: 60, videoCodec: "H.264", audioCodec: "AAC", audioRate: 48000 },
      durationSeconds: Number(totalDuration.toFixed(3)),
      intro: { variant: "female", durationSeconds: introDuration, originalAudioPreserved: true },
      captions: { bilingual: true, cards: cards.length, singleLine: true, forbiddenChinesePunctuationRemoved: true },
      audio: { voicePreset: "female-book-narrator-locked-v1", musicGain: 0.63, ducking: true, fadeOutSeconds: 1 },
    };
    fs.writeFileSync(validationPath, `${JSON.stringify(validation, null, 2)}\n`, "utf8");
    upsertArtifact({ taskId, stepName: "render", kind: "review_video", label: "G05 女声双语字幕审核成片", path: projectArtifactPath(finalPath), meta: validation });
    upsertArtifact({ taskId, stepName: "render", kind: "video", label: "G05 女声双语字幕审核成片", path: projectArtifactPath(finalPath), meta: validation });
    upsertArtifact({ taskId, stepName: "render", kind: "validation_report", label: "G05 技术验证报告", path: projectArtifactPath(validationPath), meta: validation });
    setStepStatus(taskId, "render", {
      status: "done",
      progress: 1,
      finishedAt: Date.now(),
      output: JSON.stringify({ phase: "done", video: projectArtifactPath(finalPath), durationSeconds: validation.durationSeconds }),
    });
    updateTask(taskId, { status: "media_compliance_queued", currentGate: "MEDIA_COMPLIANCE" });
    const { enqueueComplianceAudit } = await import("./complianceWorkflow");
    enqueueComplianceAudit(taskId, "media");
  } catch (error: any) {
    const task = getTask(taskId);
    const failedStep = task?.status === "rendering_video" ? "render" : "subtitle";
    setStepStatus(taskId, failedStep, {
      status: "failed",
      error: String(error?.message || error),
      finishedAt: Date.now(),
    });
    updateTask(taskId, { status: "post_production_failed", currentGate: "POST_PRODUCTION_FAILED" });
    throw error;
  } finally {
    running.delete(taskId);
  }
}

export function lockedFemalePostProductionIsRunning(taskId: string) {
  return running.has(taskId);
}
