import { getTask, setStepStatus, saveArtifact, getArtifacts, clearArtifacts, taskDir } from "../pipeline/repo";
import { getTts, probeDuration, type TtsProgressEvent } from "../providers/tts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { buildAtempoFilter, normalizeSpeed } from "./ttsSpeed";
import { estimateSegmentDuration, parseSegmentArtifactMeta, splitScriptSegments, toScriptSegmentMeta } from "./scriptSegments";

const execFileP = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN?.trim() || "ffmpeg";

function roundDur(sec: number): number {
  return +Math.max(0, sec || 0).toFixed(3);
}

type TtsSegmentMeta = {
  idx: number;
  text: string;
  wav: string;
  speed: number;
  speedApplied: boolean;
  speedFilter: string | null;
  rawDur: number;
  speedDur: number;
  dur: number;
};

function readTtsConfig(arts: ReturnType<typeof getArtifacts>) {
  for (const a of arts) {
    if (a.stepName !== "config" || a.kind !== "json" || !a.meta) continue;
    try {
      const meta = JSON.parse(a.meta);
      if (meta.key === "tts" && meta.value && typeof meta.value === "object") return meta.value;
    } catch { /* ignore bad config */ }
  }
  return {};
}

function boundedJobProgress(event: TtsProgressEvent): number {
  const n = Number(event.jobProgress);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export async function runTts(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  clearArtifacts(taskId, "tts");

  const arts = getArtifacts(taskId);
  const script = arts.find((a) => a.stepName === "rewrite" && a.kind === "rewrite")?.content;
  if (!script) throw new Error("缺少改写后口播稿");
  const ttsConfig = readTtsConfig(arts);
  const configuredVoice = typeof ttsConfig.voice === "string" && ttsConfig.voice.trim() ? ttsConfig.voice.trim() : "常用";
  const voice = configuredVoice === "default" || configuredVoice === "自用" ? "自用" : configuredVoice === "warm" ? "常用" : configuredVoice === "bright" ? "女声自用" : configuredVoice;
  const providerVoice = voice === "自用" ? "default" : voice;
  const speed = normalizeSpeed(ttsConfig.speed);
  const speedFilter = Math.abs(speed - 1) > 0.001 ? buildAtempoFilter(speed) : null;
  const speedApplied = !!speedFilter;
  const tts = getTts();
  const writeProgress = (payload: Record<string, unknown>, progress?: number) => {
    setStepStatus(taskId, "tts", {
      ...(typeof progress === "number" ? { progress } : {}),
      output: JSON.stringify({
        provider: tts.name,
        voice,
        speed,
        speedApplied,
        ...payload,
      }),
    });
  };

  // 1. 读取 rewrite 阶段已经生成的正式口播分段；老任务没有时现场补一份。
  writeProgress({ phase: "preparing-segments" }, 0.15);
  const segmentArtifact = arts.find((a) => a.stepName === "rewrite" && a.kind === "segments");
  let segments = parseSegmentArtifactMeta(segmentArtifact?.meta);
  let segmentSource = segmentArtifact ? "rewrite" : "tts-fallback";
  if (!segments.length) {
    segments = await splitScriptSegments(task, script);
    segmentSource = "tts-fallback";
    saveArtifact({
      taskId,
      stepName: "rewrite",
      kind: "segments",
      label: "口播分段",
      meta: {
        source: segmentSource,
        segments: toScriptSegmentMeta(segments).map((segment) => ({
          ...segment,
          estimatedDur: estimateSegmentDuration(segment.text),
        })),
        count: segments.length,
      },
    });
  }
  writeProgress({ phase: "segments-ready", segmentSource, totalSegments: segments.length, completedSegments: 0 }, 0.18);

  // 2. 逐段合成
  const dir = taskDir(taskId);
  const segMeta: TtsSegmentMeta[] = [];
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const wav = path.join(dir, `seg_${String(i).padStart(2, "0")}.wav`);
    writeProgress({
      phase: "synthesizing",
      segmentSource,
      currentSegment: i + 1,
      totalSegments: segments.length,
      completedSegments: i,
      textPreview: segments[i].replace(/\s+/g, " ").slice(0, 80),
    }, 0.18 + 0.67 * (i / Math.max(1, segments.length)));
    // Speed is intentionally applied once below with ffmpeg atempo. Provider-level
    // speed is not passed here, avoiding double speed adjustment across providers.
    const r = await tts.synthesize(segments[i], wav, {
      voice: providerVoice,
      onProgress: (event) => {
        const jobProgress = boundedJobProgress(event);
        writeProgress({
          phase: "synthesizing",
          segmentSource,
          currentSegment: i + 1,
          totalSegments: segments.length,
          completedSegments: i,
          textPreview: segments[i].replace(/\s+/g, " ").slice(0, 80),
          ttsJob: event,
        }, 0.18 + 0.67 * ((i + jobProgress) / Math.max(1, segments.length)));
      },
    });
    const rawDur = await probeDuration(wav) || r.durationSec || 0;
    let speedDur = rawDur;
    if (speedFilter) {
      const speeded = path.join(dir, `seg_${String(i).padStart(2, "0")}.speed.wav`);
      await execFileP(FFMPEG_BIN, [
        "-y", "-nostdin", "-i", wav,
        "-filter:a", speedFilter,
        "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le",
        speeded,
      ]);
      fs.renameSync(speeded, wav);
      speedDur = await probeDuration(wav) || (rawDur > 0 ? rawDur / speed : (r.durationSec || 0) / speed);
    }
    const dur = roundDur(speedDur);
    segMeta.push({
      idx: i,
      text: segments[i],
      wav: path.basename(wav),
      speed,
      speedApplied,
      speedFilter,
      rawDur: roundDur(rawDur),
      speedDur: dur,
      dur,
    });
    acc += dur;
    writeProgress({
      phase: "segment-saved",
      segmentSource,
      currentSegment: i + 1,
      totalSegments: segments.length,
      completedSegments: i + 1,
      lastDuration: dur,
      accumulatedDuration: roundDur(acc),
      textPreview: segments[i].replace(/\s+/g, " ").slice(0, 80),
    }, 0.18 + 0.67 * ((i + 1) / Math.max(1, segments.length)));
  }

  // 3. ffmpeg concat 合成 tts.wav（重编码统一格式：真人声各段采样率/声道可能不一致，
  //    -c copy 会拼接失败或音画错位，故统一转 24k/mono/pcm_s16le）
  writeProgress({ phase: "merging", segmentSource, totalSegments: segments.length, completedSegments: segments.length }, 0.9);
  const listPath = path.join(dir, "tts_concat.txt");
  fs.writeFileSync(listPath, segMeta.map((s) => `file '${s.wav}'`).join("\n"), "utf-8");
  const outWav = path.join(dir, "tts.wav");
  await execFileP(FFMPEG_BIN, [
    "-y", "-nostdin", "-f", "concat", "-safe", "0", "-i", listPath,
    "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", outWav,
  ]);
  try { fs.unlinkSync(listPath); } catch {}
  // 清理中间分段 wav（已并入 tts.wav；字幕只用 segMeta 文本/时长，渲染只用 tts.wav）
  for (const s of segMeta) { try { fs.unlinkSync(path.join(dir, s.wav)); } catch {} }
  // 校准总时长：用合成后实际时长覆盖各段估时之和（重编码后更准）
  const realDur = await probeDuration(outWav);
  if (realDur > 0) acc = realDur;
  writeProgress({ phase: "saving-artifact", segmentSource, totalSegments: segments.length, completedSegments: segments.length, totalDur: +acc.toFixed(2) }, 0.95);

  // 4. 产物：音频 + 段落时间轴（供字幕/渲染参考）
  saveArtifact({
    taskId, stepName: "tts", kind: "audio", label: "配音 tts.wav",
    path: path.relative(process.cwd(), outWav),
    meta: {
      provider: tts.name,
      voice,
      speed,
      segmentSource,
      speedApplied,
      speedMode: speedApplied ? "ffmpeg-atempo" : "none",
      speedFilter,
      totalDur: +acc.toFixed(2),
      segments: segMeta,
    },
  });

  setStepStatus(taskId, "tts", {
    output: JSON.stringify({ phase: "done", provider: tts.name, voice, speed, segmentSource, speedApplied, segs: segments.length, totalSegments: segments.length, completedSegments: segments.length, totalDur: +acc.toFixed(2) }),
  });
}
