#!/usr/bin/env node
import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const taskId = args[0] || "mNHNUuyk4KgZ";
const speed = Number(valueArg("--speed") || "1.78");
const baseUrl = String(valueArg("--base-url") || process.env.INDEX_TTS2_URL || "http://192.168.5.244:7860").replace(/\/+$/, "");
const voices = (valueArg("--voices") || "default,女声自用").split(",").map((s) => s.trim()).filter(Boolean);
const pollMs = Number(valueArg("--poll-ms") || "3000");
const jobTimeoutMs = Number(valueArg("--job-timeout-ms") || String(60 * 60 * 1000));

function valueArg(name) {
  const idx = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (idx < 0) return "";
  if (args[idx].includes("=")) return args[idx].split("=").slice(1).join("=");
  return args[idx + 1] || "";
}

function voiceSlug(voice) {
  if (voice === "default") return "self";
  if (voice === "女声自用") return "female";
  if (voice === "常用") return "common";
  return voice.replace(/[^\w.-]+/g, "_") || "voice";
}

function atempoFilter(value) {
  let remaining = Math.max(0.5, Math.min(100, Number(value) || 1));
  const parts = [];
  while (remaining > 2) {
    parts.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    parts.push(0.5);
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 0.001 || !parts.length) parts.push(remaining);
  return parts.map((n) => `atempo=${n.toFixed(6)}`).join(",");
}

async function probeDuration(file) {
  try {
    const { stdout } = await execFileP("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", file,
    ]);
    const n = Number.parseFloat(stdout.trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function loadSegments() {
  const db = new Database(path.join(repoRoot, "data", "app.db"));
  try {
    const row = db.prepare(`
      SELECT meta FROM artifacts
      WHERE task_id = ? AND step_name = 'tts' AND kind = 'audio'
      ORDER BY created_at DESC LIMIT 1
    `).get(taskId);
    const meta = row?.meta ? JSON.parse(row.meta) : {};
    const segments = Array.isArray(meta.segments) ? meta.segments.map((s) => String(s.text || "").trim()).filter(Boolean) : [];
    if (!segments.length) throw new Error(`任务 ${taskId} 缺少 tts 音频分段 meta`);
    return segments;
  } finally {
    db.close();
  }
}

async function createJob(text, voice) {
  const resp = await fetch(`${baseUrl}/tts/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });
  if (!resp.ok) throw new Error(`创建 TTS job 失败 ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const payload = await resp.json();
  const job = payload.job || payload;
  const id = String(job.id || job.job_id || "").trim();
  if (!id) throw new Error("创建 TTS job 后未返回 id");
  return id;
}

async function waitJob(jobId, voice, idx, total) {
  const deadline = Date.now() + jobTimeoutMs;
  while (true) {
    if (Date.now() > deadline) throw new Error(`TTS job 超时: ${jobId}`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const resp = await fetch(`${baseUrl}/tts/jobs/${encodeURIComponent(jobId)}`);
    if (!resp.ok) throw new Error(`轮询 TTS job 失败 ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const payload = await resp.json();
    const job = payload.job || payload;
    const status = String(job.status || "unknown");
    const progress = Number.isFinite(Number(job.progress)) ? Math.round(Number(job.progress) * 100) : "";
    process.stdout.write(`\r[${voice}] ${idx}/${total} ${status}${progress !== "" ? ` ${progress}%` : ""}        `);
    if (status === "succeeded") {
      process.stdout.write("\n");
      return;
    }
    if (status === "failed" || status === "canceled") {
      throw new Error(`TTS job ${status}: ${String(job.error || "unknown").slice(0, 200)}`);
    }
  }
}

async function downloadJobAudio(jobId, outPath) {
  const resp = await fetch(`${baseUrl}/tts/jobs/${encodeURIComponent(jobId)}/audio`);
  if (!resp.ok) throw new Error(`下载 TTS 音频失败 ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  fs.writeFileSync(outPath, Buffer.from(await resp.arrayBuffer()));
  const normPath = outPath.replace(/\.wav$/i, ".norm.wav");
  await execFileP("ffmpeg", ["-y", "-nostdin", "-i", outPath, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", normPath]);
  fs.renameSync(normPath, outPath);
}

async function ensureSegment(text, voice, idx, total, outPath) {
  if (fs.existsSync(outPath) && await probeDuration(outPath) > 0.1) return;
  console.log(`[${voice}] 创建分段 ${idx}/${total}`);
  const jobId = await createJob(text, voice);
  await waitJob(jobId, voice, idx, total);
  await downloadJobAudio(jobId, outPath);
}

async function concatWavs(files, outPath, workDir) {
  const listPath = path.join(workDir, "_concat.txt");
  fs.writeFileSync(listPath, files.map((file) => `file '${path.resolve(file)}'`).join("\n"), "utf-8");
  await execFileP("ffmpeg", [
    "-y", "-nostdin", "-f", "concat", "-safe", "0", "-i", listPath,
    "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", outPath,
  ]);
  try { fs.unlinkSync(listPath); } catch {}
}

async function makePreview(voice, segments) {
  const taskDir = path.join(repoRoot, "data", "tasks", taskId);
  const previewDir = path.join(taskDir, "voice-speed-previews", voiceSlug(voice));
  fs.mkdirSync(previewDir, { recursive: true });
  const segmentFiles = [];
  for (let i = 0; i < segments.length; i++) {
    const out = path.join(previewDir, `seg_${String(i).padStart(2, "0")}.wav`);
    await ensureSegment(segments[i], voice, i + 1, segments.length, out);
    segmentFiles.push(out);
  }

  const rawWav = path.join(previewDir, `voice_${voiceSlug(voice)}.wav`);
  const speedWav = path.join(previewDir, `voice_${voiceSlug(voice)}_${speed}x.wav`);
  const outMp4 = path.join(taskDir, `final_chapters_quick_1_${voiceSlug(voice)}_${speed}x.mp4`);
  const baseVideo = path.join(taskDir, `final_chapters_quick_1_${speed}x.mp4`);
  if (!fs.existsSync(baseVideo)) throw new Error(`缺少基准视频: ${baseVideo}`);

  console.log(`[${voice}] 合并 ${segmentFiles.length} 段音频`);
  await concatWavs(segmentFiles, rawWav, previewDir);
  console.log(`[${voice}] 应用 ${speed}x 语速`);
  await execFileP("ffmpeg", [
    "-y", "-nostdin", "-i", rawWav,
    "-filter:a", atempoFilter(speed),
    "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", speedWav,
  ]);
  console.log(`[${voice}] 合成预览 MP4`);
  await execFileP("ffmpeg", [
    "-y", "-nostdin", "-i", baseVideo, "-i", speedWav,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
    "-shortest", "-movflags", "+faststart", outMp4,
  ]);
  const rawDur = await probeDuration(rawWav);
  const speedDur = await probeDuration(speedWav);
  const videoDur = await probeDuration(outMp4);
  console.log(JSON.stringify({ voice, rawWav, speedWav, outMp4, rawDur, speedDur, videoDur }, null, 2));
}

const segments = loadSegments();
console.log(`task=${taskId} segments=${segments.length} voices=${voices.join(",")} speed=${speed} baseUrl=${baseUrl}`);
for (const voice of voices) {
  await makePreview(voice, segments);
}
