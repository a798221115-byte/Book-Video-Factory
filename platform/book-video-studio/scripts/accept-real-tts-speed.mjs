#!/usr/bin/env node
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Database from "better-sqlite3";

const execFileP = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(repoRoot, "data", "app.db");
const stepNames = ["extract", "transcribe", "rewrite", "tts", "subtitle", "images", "render"];
const defaultText = [
  "真正的长期主义，不是每天都很亢奋，而是在普通日子里把关键动作重复做对。",
  "读书也一样，你不是为了记住每一句话，而是为了在某个选择前，多一个更清醒的判断。",
  "今天这段音频只用于验证语速，慢一点要稳，正常要自然，快一点也不能挤在一起。",
].join("");

const options = parseArgs(process.argv.slice(2));
const speeds = (options.speeds ?? "0.9,1.0,1.1").split(",").map((v) => Number(v.trim())).filter(Number.isFinite);
const baseUrl = (options.baseUrl ?? process.env.ACCEPT_TTS_BASE_URL ?? "http://127.0.0.1:3939").replace(/\/+$/, "");
const voice = options.voice ?? process.env.ACCEPT_TTS_VOICE ?? "default";
const text = options.text ?? process.env.ACCEPT_TTS_TEXT ?? defaultText;
const ffprobeBin = options.ffprobeBin ?? process.env.FFPROBE_BIN ?? "ffprobe";
const timeoutMs = Number(options.timeoutMs ?? process.env.ACCEPT_TTS_TIMEOUT_MS ?? 480_000);

if (speeds.length < 2) throw new Error("Need at least two speeds, for example --speeds 0.9,1.0,1.1");
if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

await waitForServer(baseUrl);

const db = new Database(dbPath);
const rows = [];
try {
  for (const speed of speeds) {
    const taskId = createAcceptanceTask(db, { speed, voice, text });
    await triggerTts(baseUrl, taskId);
    const status = await waitForTts(baseUrl, taskId, timeoutMs);
    const audio = status.artifacts.find((a) => a.stepName === "tts" && a.kind === "audio");
    if (!audio?.path) throw new Error(`${taskId}: missing tts audio artifact`);
    const meta = parseJson(audio.meta);
    const audioPath = path.resolve(repoRoot, audio.path);
    const probedDuration = await probeDuration(audioPath);
    const segments = Array.isArray(meta.segments) ? meta.segments : [];
    const rawDur = sum(segments.map((s) => Number(s.rawDur || 0)));
    const speedDur = sum(segments.map((s) => Number(s.speedDur || s.dur || 0)));
    rows.push({
      speed,
      taskId,
      provider: meta.provider,
      voice: meta.voice,
      speedApplied: !!meta.speedApplied,
      speedFilter: meta.speedFilter ?? "none",
      segments: segments.length,
      rawDur,
      speedDur,
      metaTotalDur: Number(meta.totalDur || 0),
      probedDuration,
      audioPath,
    });
  }
} finally {
  db.close();
}

printRows(rows);
validateRows(rows);

console.log("OK: real TTS provider speed acceptance passed.");
console.log("Kept acceptance tasks and audio files for listening review:");
for (const row of rows) console.log(`  ${row.speed.toFixed(1)}x  ${row.taskId}  ${path.relative(repoRoot, row.audioPath)}`);

function createAcceptanceTask(db, { speed, voice, text }) {
  const now = Date.now();
  const suffix = crypto.randomBytes(3).toString("hex");
  const speedLabel = String(speed).replace(".", "");
  const taskId = `tts-speed-${speedLabel}-${now}-${suffix}`;
  const sourceUrl = `acceptance://real-tts-speed/${speed}`;
  const title = `TTS speed acceptance ${speed}x`;

  db.prepare(`
    INSERT INTO tasks (id, source_url, title, author, keyword, status, created_at, updated_at)
    VALUES (@id, @sourceUrl, @title, @author, @keyword, @status, @createdAt, @updatedAt)
  `).run({
    id: taskId,
    sourceUrl,
    title,
    author: "acceptance",
    keyword: "tts-speed",
    status: "created",
    createdAt: now,
    updatedAt: now,
  });

  const insertStep = db.prepare(`
    INSERT INTO steps (id, task_id, name, status, output, progress, started_at, finished_at)
    VALUES (@id, @taskId, @name, @status, @output, @progress, @startedAt, @finishedAt)
  `);
  for (const name of stepNames) {
    const done = ["extract", "transcribe", "rewrite"].includes(name);
    insertStep.run({
      id: crypto.randomBytes(6).toString("base64url"),
      taskId,
      name,
      status: done ? "done" : "pending",
      output: done ? JSON.stringify({ acceptance: true }) : null,
      progress: done ? 1 : 0,
      startedAt: done ? now : null,
      finishedAt: done ? now : null,
    });
  }

  const insertArtifact = db.prepare(`
    INSERT INTO artifacts (id, task_id, step_name, kind, label, path, content, meta, created_at)
    VALUES (@id, @taskId, @stepName, @kind, @label, @path, @content, @meta, @createdAt)
  `);
  insertArtifact.run({
    id: crypto.randomBytes(6).toString("base64url"),
    taskId,
    stepName: "rewrite",
    kind: "rewrite",
    label: "TTS speed acceptance script",
    path: null,
    content: text,
    meta: null,
    createdAt: now,
  });
  insertArtifact.run({
    id: crypto.randomBytes(6).toString("base64url"),
    taskId,
    stepName: "config",
    kind: "json",
    label: "tts 配置",
    path: null,
    content: null,
    meta: JSON.stringify({ key: "tts", value: { voice, speed }, updatedAt: now }),
    createdAt: now,
  });

  fs.mkdirSync(path.join(repoRoot, "data", "tasks", taskId), { recursive: true });
  return taskId;
}

async function triggerTts(baseUrl, taskId) {
  const resp = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskId)}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "run", step: "tts" }),
  });
  if (!resp.ok) throw new Error(`${taskId}: run request failed ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
}

async function waitForTts(baseUrl, taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "pending";
  while (Date.now() < deadline) {
    const status = await getStatus(baseUrl, taskId);
    const step = status.steps.find((s) => s.name === "tts");
    lastStatus = step?.status ?? "missing";
    if (lastStatus === "done") return status;
    if (lastStatus === "failed") throw new Error(`${taskId}: tts failed: ${step?.error || "unknown error"}`);
    await sleep(1500);
  }
  throw new Error(`${taskId}: timed out waiting for tts (${timeoutMs}ms), last status=${lastStatus}`);
}

async function getStatus(baseUrl, taskId) {
  const resp = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskId)}/status`);
  if (!resp.ok) throw new Error(`${taskId}: status request failed ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  return resp.json();
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 60_000;
  let last = "not attempted";
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(baseUrl);
      last = `HTTP ${resp.status}`;
      if (resp.status < 500) return;
    } catch (e) {
      const cause = e?.cause;
      last = [e?.message || String(e), cause?.code, cause?.address, cause?.port].filter(Boolean).join(" ");
    }
    await sleep(1000);
  }
  throw new Error(`Server did not become reachable: ${baseUrl} (last: ${last})`);
}

async function probeDuration(file) {
  const { stdout } = await execFileP(ffprobeBin, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not probe duration for ${file}`);
  return duration;
}

function printRows(rows) {
  console.table(rows.map((row) => ({
    speed: row.speed.toFixed(1),
    taskId: row.taskId,
    provider: row.provider,
    voice: row.voice,
    filter: row.speedFilter,
    segments: row.segments,
    raw_s: row.rawDur.toFixed(3),
    speed_s: row.speedDur.toFixed(3),
    meta_s: row.metaTotalDur.toFixed(3),
    probe_s: row.probedDuration.toFixed(3),
    normalized_s: (row.probedDuration * row.speed).toFixed(3),
  })));
}

function validateRows(rows) {
  for (const row of rows) {
    if (!row.provider || String(row.provider).includes("mock")) {
      throw new Error(`${row.taskId}: expected a real TTS provider, got ${row.provider || "<missing>"}`);
    }
    if (Math.abs(row.speed - 1) < 0.001) {
      if (row.speedApplied) throw new Error(`${row.taskId}: speed=1.0 should not apply atempo`);
    } else if (!row.speedApplied || row.speedFilter === "none") {
      throw new Error(`${row.taskId}: speed=${row.speed} did not apply atempo`);
    }
    if (row.segments < 1) throw new Error(`${row.taskId}: missing segment metadata`);
    const metaDelta = Math.abs(row.probedDuration - row.metaTotalDur);
    if (metaDelta > 0.15) throw new Error(`${row.taskId}: probed duration differs from artifact totalDur by ${metaDelta.toFixed(3)}s`);
    const speedDelta = Math.abs(row.probedDuration - row.speedDur);
    if (speedDelta > Math.max(0.25, row.probedDuration * 0.02)) {
      throw new Error(`${row.taskId}: probed duration differs from summed segment speedDur by ${speedDelta.toFixed(3)}s`);
    }
  }

  const sorted = [...rows].sort((a, b) => a.speed - b.speed);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].probedDuration <= sorted[i].probedDuration) {
      throw new Error("Duration order check failed: lower speed should produce longer audio");
    }
  }

  const normalized = rows.map((row) => row.probedDuration * row.speed);
  const avg = sum(normalized) / normalized.length;
  const maxDelta = Math.max(...normalized.map((value) => Math.abs(value - avg)));
  if (maxDelta > Math.max(0.6, avg * 0.08)) {
    throw new Error(`Normalized duration variance is too high: max delta ${maxDelta.toFixed(3)}s around avg ${avg.toFixed(3)}s`);
  }
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const [rawKey, inline] = arg.split("=", 2);
    const key = rawKey.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (inline !== undefined) {
      out[key] = inline;
    } else {
      if (i + 1 >= args.length) throw new Error(`Missing value for ${arg}`);
      out[key] = args[++i];
    }
  }
  return out;
}

function parseJson(value) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function sum(values) {
  return values.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
