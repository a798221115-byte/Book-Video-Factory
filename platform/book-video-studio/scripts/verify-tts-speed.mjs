#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const SPEEDS = [0.9, 1.0, 1.1];
let ffmpegBin = process.env.FFMPEG_BIN || "ffmpeg";
let ffprobeBin = process.env.FFPROBE_BIN || "ffprobe";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = await mkdtemp(path.join(os.tmpdir(), "book-video-studio-tts-speed-"));
const { buildAtempoFilter } = await importTsHelper("lib/steps/ttsSpeed.ts", "ttsSpeed.mjs");

async function probeDuration(file) {
  const { stdout } = await execFileP(ffprobeBin, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const d = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`Could not probe duration for ${file}`);
  return d;
}

async function makeSourceAudio(outPath) {
  await execFileP(ffmpegBin, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000",
    "-t", "8",
    "-ac", "1", "-c:a", "pcm_s16le",
    outPath,
  ]);
}

async function renderAtSpeed(source, speed, outPath) {
  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", source,
  ];
  if (Math.abs(speed - 1) >= 0.001) {
    args.push("-filter:a", buildAtempoFilter(speed));
  }
  args.push("-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", outPath);
  await execFileP(ffmpegBin, args);
}

function readValueArg(args, index, name) {
  if (args[index].includes("=")) return args[index].split("=").slice(1).join("=");
  if (index + 1 >= args.length) throw new Error(`Missing value for ${name}`);
  return args[index + 1];
}

function consumeValueArg(args, index) {
  return args[index].includes("=") ? index : index + 1;
}

function resolveInput(input) {
  if (!input) return null;
  const direct = path.resolve(input);
  if (existsSync(direct)) return direct;
  const taskAudio = path.join(repoRoot, "data", "tasks", input, "tts.wav");
  if (existsSync(taskAudio)) return taskAudio;
  throw new Error(`Input not found as a file or data/tasks/<id>/tts.wav: ${input}`);
}

function usage() {
  console.log([
    "Usage:",
    "  node scripts/verify-tts-speed.mjs [audio-file-or-task-id] [--keep] [--ffmpeg-bin <path>] [--ffprobe-bin <path>]",
    "",
    "Without an input, the script generates one 8s wav and compares speeds 0.9, 1.0, 1.1.",
    "With a task id, it uses data/tasks/<task-id>/tts.wav as the shared source audio.",
    "FFMPEG_BIN and FFPROBE_BIN are also supported.",
  ].join("\n"));
}

async function importTsHelper(relSource, outName) {
  const sourcePath = path.join(repoRoot, relSource);
  const compiledPath = path.join(tmpDir, outName);
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
    fileName: sourcePath,
  }).outputText;
  fs.writeFileSync(compiledPath, compiled, "utf8");
  return import(pathToFileURL(compiledPath).href);
}

const args = process.argv.slice(2);
let input = null;
let keep = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  } else if (arg === "--keep") {
    keep = true;
  } else if (arg === "--ffmpeg-bin" || arg.startsWith("--ffmpeg-bin=")) {
    ffmpegBin = readValueArg(args, i, "--ffmpeg-bin");
    i = consumeValueArg(args, i);
  } else if (arg === "--ffprobe-bin" || arg.startsWith("--ffprobe-bin=")) {
    ffprobeBin = readValueArg(args, i, "--ffprobe-bin");
    i = consumeValueArg(args, i);
  } else if (!input) {
    input = arg;
  } else {
    throw new Error(`Unexpected argument: ${arg}`);
  }
}

try {
  const source = resolveInput(input) || path.join(tmpDir, "source.wav");
  if (!input) await makeSourceAudio(source);

  const sourceDur = await probeDuration(source);
  const rows = [];
  for (const speed of SPEEDS) {
    const out = path.join(tmpDir, `speed-${speed.toFixed(1)}.wav`);
    await renderAtSpeed(source, speed, out);
    const actual = await probeDuration(out);
    const expected = sourceDur / speed;
    rows.push({
      speed,
      filter: Math.abs(speed - 1) < 0.001 ? "none" : buildAtempoFilter(speed),
      expected,
      actual,
      delta: actual - expected,
    });
  }

  console.log(`Source: ${source}`);
  console.log(`Source duration: ${sourceDur.toFixed(3)}s`);
  console.table(rows.map((row) => ({
    speed: row.speed.toFixed(1),
    filter: row.filter,
    expected_s: row.expected.toFixed(3),
    actual_s: row.actual.toFixed(3),
    delta_s: row.delta.toFixed(3),
  })));

  const bySpeed = new Map(rows.map((row) => [row.speed, row.actual]));
  const tolerance = Math.max(0.12, sourceDur * 0.02);
  const bad = rows.filter((row) => Math.abs(row.delta) > tolerance);
  if ((bySpeed.get(0.9) ?? 0) <= (bySpeed.get(1.0) ?? 0) || (bySpeed.get(1.1) ?? Infinity) >= (bySpeed.get(1.0) ?? 0)) {
    throw new Error("Duration order check failed: expected 0.9 > 1.0 > 1.1");
  }
  if (bad.length) {
    throw new Error(`Duration delta exceeded tolerance ${tolerance.toFixed(3)}s`);
  }

  console.log("OK: speed changes produce the expected duration order and measured durations.");
  if (keep) console.log(`Kept outputs in ${tmpDir}`);
} finally {
  if (!keep) await rm(tmpDir, { recursive: true, force: true });
}
