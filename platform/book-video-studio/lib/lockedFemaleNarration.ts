import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
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
import { startLockedFemalePostProduction } from "./lockedFemalePostProduction";
import { isTitleWorkflowComplete, readTitleWorkflowMeta } from "./titleWorkflow";

const execFileP = promisify(execFile);
const PYTHON = "F:\\Codex\\tools\\voxcpm2-venv\\Scripts\\python.exe";
const MODEL_CACHE = "F:\\Codex\\tools\\voxcpm2-models";
const SKILL_ROOT = "F:\\Codex\\.codex\\skills\\produce-wechat-book-video";
const PRESET_PATH = path.join(
  "E:\\BaiduNetdiskWorkspace\\电脑其他文件同步\\视频号\\AI视频",
  "assets",
  "voice-presets",
  "female-book-narrator-locked-v1.json",
);
const DEFAULT_CONFIG = path.join(SKILL_ROOT, "assets", "default-config.json");
const VARIANT_RESOLVER = path.join(SKILL_ROOT, "scripts", "resolve_production_variant.py");
const running: Set<string> = ((globalThis as any).__lockedFemaleNarrationJobs ??= new Set<string>());

function parseMeta(meta: string | null | undefined) {
  try { return meta ? JSON.parse(meta) : {}; }
  catch { return {}; }
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

function probeWavDuration(filePath: string) {
  const wav = fs.readFileSync(filePath);
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`不是有效的 WAV 文件：${filePath}`);
  }
  let byteRate = 0;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const chunkId = wav.toString("ascii", offset, offset + 4);
    const chunkSize = wav.readUInt32LE(offset + 4);
    if (chunkId === "fmt " && chunkSize >= 16) byteRate = wav.readUInt32LE(offset + 16);
    if (chunkId === "data") {
      dataBytes = Math.min(chunkSize, wav.length - offset - 8);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (!byteRate || !dataBytes) throw new Error(`无法读取 WAV 时长：${filePath}`);
  return dataBytes / byteRate;
}

function readStoryboard(taskId: string) {
  const filePath = path.join(taskDir(taskId), "storyboard", "storyboard.json");
  if (!fs.existsSync(filePath)) throw new Error("缺少 storyboard/storyboard.json");
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  // Older storyboard exports call the semantic shot list `shots`; normalize
  // it to the newer `beats` name used by post-production.
  if (!Array.isArray(value.beats) && Array.isArray(value.shots)) value.beats = value.shots;
  return { filePath, value };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readVoiceGenerationConfig() {
  const defaults = JSON.parse(fs.readFileSync(DEFAULT_CONFIG, "utf8"));
  const config = defaults.voiceGeneration || {};
  const ordinary: number[] = Array.isArray(config.ordinaryPauseSeconds)
    ? config.ordinaryPauseSeconds.map(Number).filter(Number.isFinite)
    : [Number(config.ordinaryPauseSeconds)];
  return {
    speechSpeed: Number(config.speechSpeed ?? 0.92),
    bookNamePauseSeconds: Number(config.bookNamePauseSeconds ?? 2.3),
    ordinaryPauseSeconds: ordinary.length
      ? ordinary.reduce((sum, value) => sum + value, 0) / ordinary.length
      : 0.85,
    finalPauseSeconds: Number(config.finalPauseSeconds ?? 0.5),
  };
}

function prepareSegments(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  const { filePath, value: storyboard } = readStoryboard(taskId);
  const beats = Array.isArray(storyboard.beats) ? storyboard.beats : [];
  if (!beats.length) throw new Error("storyboard.json 没有可用分镜");
  const voiceConfig = readVoiceGenerationConfig();
  const title = `《${task.bookTitle || storyboard.book?.title || ""}》`;
  const segments: { text: string; beatId: string; pauseAfterSeconds: number }[] = [];
  if (title !== "《》") {
    segments.push({ text: title, beatId: String(beats[0]?.id || "title"), pauseAfterSeconds: voiceConfig.bookNamePauseSeconds });
  }
  const duplicateShareLine = title === "《》"
    ? null
    : new RegExp(`^(?:我们)?今天(?:要)?分享(?:的是)?\\s*${escapeRegExp(title)}[。！？!?\\s]*`);
  for (const beat of beats) {
    let text = String(beat.script_text || beat.narration || beat.scriptText || "").trim();
    if (!text) continue;
    const beatId = String(beat.id);
    if (title !== "《》" && text.startsWith(title)) text = text.slice(title.length).replace(/^[。！？!?\s]+/, "").trim();
    if (duplicateShareLine) text = text.replace(duplicateShareLine, "").trim();
    if (text) segments.push({ text, beatId, pauseAfterSeconds: voiceConfig.ordinaryPauseSeconds });
  }
  if (!segments.length) throw new Error("分镜中缺少 script_text");
  segments[segments.length - 1].pauseAfterSeconds = voiceConfig.finalPauseSeconds;
  return { task, storyboard, storyboardPath: filePath, segments, speechSpeed: voiceConfig.speechSpeed };
}

function timelineMatchesSegments(timelinePath: string, segments: { text: string; pauseAfterSeconds: number }[], speechSpeed: number) {
  if (!fs.existsSync(timelinePath)) return false;
  try {
    const previousTimeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
    const previousSegments = Array.isArray(previousTimeline.timeline) ? previousTimeline.timeline : [];
    return Number(previousTimeline.speechSpeed ?? 1) === speechSpeed && previousSegments.length === segments.length && previousSegments.every(
      (item: any, index: number) =>
        String(item.text || "") === segments[index].text &&
        Number(item.pauseAfterSeconds || 0) === segments[index].pauseAfterSeconds,
    );
  } catch {
    return false;
  }
}

export function lockedFemaleNarrationNeedsRegeneration(taskId: string) {
  try {
    const { segments, speechSpeed } = prepareSegments(taskId);
    const voiceDir = path.join(taskDir(taskId), "voice");
    const timelinePath = path.join(voiceDir, "voice-timeline-female-locked-v1.json");
    const masterOutput = path.join(voiceDir, "narration-female-locked-v1-master.wav");
    return !fs.existsSync(masterOutput) || !timelineMatchesSegments(timelinePath, segments, speechSpeed);
  } catch {
    return true;
  }
}

function writeVariantArtifact(taskId: string, variant: any) {
  const voiceDir = path.join(taskDir(taskId), "voice");
  fs.mkdirSync(voiceDir, { recursive: true });
  const variantPath = path.join(voiceDir, "production-variant-female.json");
  fs.writeFileSync(variantPath, JSON.stringify(variant, null, 2) + "\n", "utf8");
  upsertArtifact({
    taskId,
    stepName: "config",
    kind: "production_variant",
    label: "G05 默认女声生产变体",
    path: projectArtifactPath(variantPath),
    meta: variant,
  });
}

function updateStoryboardVoiceTimings(
  storyboardPath: string,
  storyboard: any,
  segmentBeatIds: string[],
  timeline: any[],
) {
  const grouped = new Map<string, { start: number; end: number }>();
  timeline.forEach((segment, index) => {
    const beatId = segmentBeatIds[index];
    if (!beatId) return;
    const start = Number(segment.startSeconds || 0);
    const end = Number(segment.endSeconds || start);
    const current = grouped.get(beatId);
    grouped.set(beatId, {
      start: current ? Math.min(current.start, start) : start,
      end: current ? Math.max(current.end, end) : end,
    });
  });
  storyboard.beats = (storyboard.beats || []).map((beat: any) => {
    const timing = grouped.get(String(beat.id));
    if (!timing) return beat;
    return {
      ...beat,
      actual_voice_start_seconds: Number(timing.start.toFixed(3)),
      actual_voice_end_seconds: Number(timing.end.toFixed(3)),
      actual_voice_duration_seconds: Number((timing.end - timing.start).toFixed(3)),
    };
  });
  storyboard.timing_authority = "voice/voice-timeline-female-locked-v1.json";
  fs.writeFileSync(storyboardPath, JSON.stringify(storyboard, null, 2) + "\n", "utf8");
}

async function runPythonWithProgress(taskId: string, args: string[], totalSegments: number) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(PYTHON, args, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const match = line.match(/^PROGRESS_(START|DONE) (\d+)\/(\d+)/);
        if (!match) continue;
        const completed = match[1] === "DONE" ? Number(match[2]) : Number(match[2]) - 1;
        setStepStatus(taskId, "tts", {
          progress: 0.08 + 0.8 * (completed / Math.max(1, totalSegments)),
          output: JSON.stringify({
            phase: match[1] === "DONE" ? "segment-saved" : "synthesizing",
            variant: "female",
            preset: "female-book-narrator-locked-v1",
            completedSegments: completed,
            totalSegments,
          }),
        });
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-8000); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`VoxCPM2 女声生成失败(code=${code})：${stderr.slice(-1200)}`));
    });
  });
}

function ensureEarlyStoryboard(taskId: string) {
  const filePath = path.join(taskDir(taskId), "storyboard", "storyboard.json");
  if (fs.existsSync(filePath)) return;
  const task = getTask(taskId);
  const scriptPath = path.join(taskDir(taskId), "script.txt");
  if (!task || !fs.existsSync(scriptPath)) throw new Error("缺少已确认的 script.txt");
  const script = fs.readFileSync(scriptPath, "utf8").trim();
  const units = script.split(/(?<=[。！？!?；;])|\n+/).map((item) => item.trim()).filter(Boolean);
  const beats: any[] = [];
  let buffer = "";
  for (const unit of units) {
    if (buffer && buffer.length + unit.length > 110) {
      beats.push({ id: `B${String(beats.length + 1).padStart(2, "0")}`, script_text: buffer });
      buffer = "";
    }
    buffer += unit;
  }
  if (buffer) beats.push({ id: `B${String(beats.length + 1).padStart(2, "0")}`, script_text: buffer });
  if (!beats.length) throw new Error("已确认文案没有可用于配音的内容");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    version: 2,
    timing_authority: "voice/voice-timeline-female-locked-v1.json",
    segmentation_rules: {
      method: "semantic-first-provisional-before-voice",
      pacing_reference_seconds: 8,
      fixed_image_count: false,
    },
    book: { title: task.bookTitle || "", author: task.bookAuthor || "" },
    beats,
  }, null, 2) + "\n", "utf8");
}

export async function startLockedFemaleNarration(
  taskId: string,
  options: { continuePostProduction?: boolean; early?: boolean } = {},
) {
  if (running.has(taskId)) throw new Error("当前任务的女声配音正在生成");
  running.add(taskId);
  let prepared: ReturnType<typeof prepareSegments>;
  try {
    if (options.early) ensureEarlyStoryboard(taskId);
    prepared = prepareSegments(taskId);
  } catch (error) {
    running.delete(taskId);
    throw error;
  }
  const { task, storyboard, storyboardPath, segments, speechSpeed } = prepared;
  const projectRoot = path.resolve(taskDir(taskId), "..", "..");
  const voiceDir = path.join(taskDir(taskId), "voice");
  const segmentDir = path.join(voiceDir, "segments-female-locked-v1");
  const segmentsFile = path.join(voiceDir, "segments-female-locked-v1.txt");
  const pausesFile = path.join(voiceDir, "pauses-female-locked-v1.json");
  const rawOutput = path.join(voiceDir, "narration-female-locked-v1-raw.wav");
  const masterOutput = path.join(voiceDir, "narration-female-locked-v1-master.wav");
  const timelinePath = path.join(voiceDir, "voice-timeline-female-locked-v1.json");
  const batchScript = path.join(process.cwd(), "scripts", "generate_locked_female_voice.py");

  fs.mkdirSync(voiceDir, { recursive: true });
  fs.writeFileSync(segmentsFile, segments.map((item) => item.text).join("\n") + "\n", "utf8");
  fs.writeFileSync(
    pausesFile,
    JSON.stringify({ pauseAfterSeconds: segments.map((item) => item.pauseAfterSeconds) }, null, 2) + "\n",
    "utf8",
  );
  setStepStatus(taskId, "tts", {
    status: "running",
    progress: 0.02,
    error: "",
    startedAt: Date.now(),
    output: JSON.stringify({
      phase: "validating-variant",
      variant: "female",
      preset: "female-book-narrator-locked-v1",
      totalSegments: segments.length,
      completedSegments: 0,
    }),
  });
  if (!options.early) {
    updateTask(taskId, { status: "generating_voice", currentGate: "VOICE_GENERATING" });
  }

  try {
    const { stdout } = await execFileP(PYTHON, [
      VARIANT_RESOLVER,
      "--config", DEFAULT_CONFIG,
      "--project-root", projectRoot,
      "--variant", "female",
    ], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
    });
    const variant = JSON.parse(stdout);
    writeVariantArtifact(taskId, {
      ...variant,
      selectedBy: "project-default",
      selectedAt: Date.now(),
      voicePreset: "assets/voice-presets/female-book-narrator-locked-v1.json",
      referenceMode: "prompt_and_reference",
      cfgValue: 2.0,
      inferenceTimesteps: 20,
      seed: 42,
      speechSpeed,
    });
    setStepStatus(taskId, "tts", {
      progress: 0.08,
      output: JSON.stringify({
        phase: "loading-voxcpm2",
        variant: "female",
        preset: "female-book-narrator-locked-v1",
        pairingValid: true,
        totalSegments: segments.length,
        completedSegments: 0,
      }),
    });
    const reusableSegments = fs.existsSync(segmentDir)
      ? fs.readdirSync(segmentDir).filter((name) => /^segment\d+\.wav$/i.test(name)).length
      : 0;
    const timelineMatches = timelineMatchesSegments(timelinePath, segments, speechSpeed);
    const canReuseSynthesis =
      fs.existsSync(rawOutput) &&
      fs.existsSync(timelinePath) &&
      reusableSegments === segments.length &&
      timelineMatches;
    if (canReuseSynthesis) {
      setStepStatus(taskId, "tts", {
        progress: 0.9,
        output: JSON.stringify({
          phase: "reusing-generated-segments",
          variant: "female",
          preset: "female-book-narrator-locked-v1",
          totalSegments: segments.length,
          completedSegments: segments.length,
        }),
      });
    } else {
      await runPythonWithProgress(taskId, [
        batchScript,
        "--preset", PRESET_PATH,
        "--segments-file", segmentsFile,
        "--pauses-file", pausesFile,
        "--output", rawOutput,
        "--segments-dir", segmentDir,
        "--timeline", timelinePath,
        "--cache-dir", MODEL_CACHE,
      ], segments.length);
    }

    const preset = JSON.parse(fs.readFileSync(PRESET_PATH, "utf8"));
    const filters = [
      speechSpeed === 1 ? "" : `atempo=${speechSpeed.toFixed(3)}`,
      preset.mastering?.stage1,
      preset.mastering?.stage2,
    ].filter(Boolean).join(",");
    setStepStatus(taskId, "tts", {
      progress: 0.92,
      output: JSON.stringify({
        phase: "mastering",
        variant: "female",
        preset: preset.id,
        totalSegments: segments.length,
        completedSegments: segments.length,
      }),
    });
    await execFileP("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", rawOutput,
      "-af", filters,
      "-ac", "2",
      "-c:a", "pcm_s16le",
      masterOutput,
    ], { windowsHide: true, maxBuffer: 1024 * 1024 });

    const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
    const durationSeconds = probeWavDuration(masterOutput);
    const nativeTimeline = Array.isArray(timeline.timeline) ? timeline.timeline : [];
    const retimed = nativeTimeline.map((item: any) => {
      const startSeconds = Number(item.startSeconds || 0) / speechSpeed;
      const speechDurationSeconds = Number(item.speechDurationSeconds || 0) / speechSpeed;
      const pauseAfterSeconds = Number(item.pauseAfterSeconds || 0) / speechSpeed;
      return {
        ...item,
        startSeconds: Number(startSeconds.toFixed(3)),
        speechDurationSeconds: Number(speechDurationSeconds.toFixed(3)),
        pauseAfterSeconds: Number(pauseAfterSeconds.toFixed(3)),
        endSeconds: Number((startSeconds + speechDurationSeconds + pauseAfterSeconds).toFixed(3)),
      };
    });
    if (retimed.length) {
      const last = retimed[retimed.length - 1];
      last.pauseAfterSeconds = Number(Math.max(0, durationSeconds - last.startSeconds - last.speechDurationSeconds).toFixed(3));
      last.endSeconds = Number(durationSeconds.toFixed(3));
    }
    timeline.nativeSpeechSpeed = 1.0;
    timeline.speechSpeed = speechSpeed;
    timeline.timeStretchMethod = speechSpeed === 1 ? "none" : "ffmpeg-atempo-pitch-preserving";
    timeline.timeline = retimed;
    timeline.masterOutput = projectArtifactPath(masterOutput);
    timeline.rawOutput = projectArtifactPath(rawOutput);
    timeline.mastering = preset.mastering;
    timeline.durationSeconds = Number(durationSeconds.toFixed(3));
    fs.writeFileSync(timelinePath, JSON.stringify(timeline, null, 2) + "\n", "utf8");
    updateStoryboardVoiceTimings(
      storyboardPath,
      storyboard,
      segments.map((item) => item.beatId),
      timeline.timeline,
    );
    upsertArtifact({
      taskId,
      stepName: "tts",
      kind: "locked_female_audio",
      label: "G05 锁定女声旁白",
      path: projectArtifactPath(masterOutput),
      meta: {
        variant: "female",
        preset: preset.id,
        referenceMode: preset.referenceMode,
        cfgValue: preset.generation.cfgValue,
        inferenceTimesteps: preset.generation.inferenceTimesteps,
        seed: preset.generation.seed,
        speechSpeed,
        durationSeconds: timeline.durationSeconds,
        timelinePath: projectArtifactPath(timelinePath),
      },
    });
    upsertArtifact({
      taskId,
      stepName: "tts",
      kind: "voice_timeline",
      label: "G05 女声真实时长时间轴",
      path: projectArtifactPath(timelinePath),
      meta: timeline,
    });
    setStepStatus(taskId, "tts", {
      status: "done",
      progress: 1,
      finishedAt: Date.now(),
      output: JSON.stringify({
        phase: "done",
        variant: "female",
        preset: preset.id,
        totalSegments: segments.length,
        completedSegments: segments.length,
        durationSeconds: timeline.durationSeconds,
      }),
    });
    setStepStatus(taskId, "voice_timeline", {
      status: "done",
      progress: 1,
      output: JSON.stringify({
        durationSeconds: timeline.durationSeconds,
        timelinePath: projectArtifactPath(timelinePath),
      }),
      finishedAt: Date.now(),
    });
    if (options.early && isTitleWorkflowComplete(readTitleWorkflowMeta(taskId))) {
      updateTask(taskId, { status: "ready_for_style_sample", currentGate: "STYLE_SAMPLE_AUTOMATION" });
    }
    if (options.continuePostProduction !== false) {
      updateTask(taskId, { status: "generating_subtitles", currentGate: "CAPTIONS_GENERATING" });
      startLockedFemalePostProduction(taskId).catch((error) =>
        console.error("[locked-female-post-production]", error),
      );
    }
  } catch (error: any) {
    setStepStatus(taskId, "tts", {
      status: "failed",
      error: String(error?.message || error),
      finishedAt: Date.now(),
    });
    if (!options.early) {
      updateTask(taskId, { status: "voice_failed", currentGate: "VOICE_GENERATION_FAILED" });
    }
    throw error;
  } finally {
    running.delete(taskId);
  }
}

export function lockedFemaleNarrationIsRunning(taskId: string) {
  return running.has(taskId);
}

/** Clear an orphaned in-memory lock after a worker restart interrupted the job. */
export function resetLockedFemaleNarration(taskId: string) {
  running.delete(taskId);
}
