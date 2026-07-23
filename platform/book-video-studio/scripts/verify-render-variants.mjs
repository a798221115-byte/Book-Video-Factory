#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULTS = {
  taskId: "-WT_yIif2Z9W",
  expectedCount: 3,
  pattern: "final_*_*_*.mp4",
  width: 1080,
  height: 1920,
  minDuration: 1,
  durationTolerance: 0.75,
  sampleTimes: "3,10,20",
};

const VALUE_OPTIONS = new Set([
  "--task-id",
  "--taskId",
  "--task-dir",
  "--tasks-root",
  "--expected-count",
  "--expected",
  "--pattern",
  "--width",
  "--height",
  "--min-duration",
  "--duration-tolerance",
  "--sample-times",
  "--ffmpeg-bin",
  "--ffprobe-bin",
]);

function usage() {
  console.log(`Usage:
  node scripts/verify-render-variants.mjs [options]

Options:
  --task-id <id>               Task id under data/tasks (default: ${DEFAULTS.taskId})
  --task-dir <path>            Explicit task directory. Overrides --task-id/--tasks-root
  --tasks-root <path>          Tasks root directory (default: data/tasks)
  --expected-count <n>         Expected number of matched mp4 files (default: ${DEFAULTS.expectedCount})
  --pattern <glob>             Filename pattern inside the task directory (default: ${DEFAULTS.pattern})
  --width <px>                 Expected video width (default: ${DEFAULTS.width})
  --height <px>                Expected video height (default: ${DEFAULTS.height})
  --min-duration <seconds>     Minimum accepted duration (default: ${DEFAULTS.minDuration})
  --duration-tolerance <sec>   Max allowed duration spread between variants (default: ${DEFAULTS.durationTolerance})
  --sample-times <csv>         Seconds used for decoded frame MD5 checks (default: ${DEFAULTS.sampleTimes})
  --ffmpeg-bin <path>          ffmpeg binary (default: FFMPEG_BIN or ffmpeg)
  --ffprobe-bin <path>         ffprobe binary (default: FFPROBE_BIN or ffprobe)
  --help                       Show this help

Examples:
  node scripts/verify-render-variants.mjs
  node scripts/verify-render-variants.mjs --task-id=-WT_yIif2Z9W --expected-count 3
  node scripts/verify-render-variants.mjs --task-id my-task --pattern "final_black_*.mp4" --expected-count 2
`);
}

function parseArgs(argv) {
  const out = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }

    const eqIndex = arg.indexOf("=");
    if (eqIndex > 0) {
      const key = arg.slice(0, eqIndex);
      const value = arg.slice(eqIndex + 1);
      if (!VALUE_OPTIONS.has(key)) {
        throw new Error(`Unknown option: ${key}`);
      }
      out[key] = value;
      continue;
    }

    if (!VALUE_OPTIONS.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (i + 1 >= argv.length) {
      throw new Error(`Missing value for ${arg}`);
    }

    out[arg] = argv[i + 1];
    i += 1;
  }

  return out;
}

function optionValue(options, ...keys) {
  for (const key of keys) {
    if (options[key] !== undefined) return options[key];
  }
  return undefined;
}

function numberOption(options, keys, fallback, label, { integer = false } = {}) {
  const raw = optionValue(options, ...keys);
  if (raw === undefined) return fallback;

  const parsed = integer ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number. Received: ${raw}`);
  }
  return parsed;
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function globToRegExp(glob) {
  let source = "^";
  for (const char of glob) {
    if (char === "*") {
      source += ".*";
    } else if (char === "?") {
      source += ".";
    } else if ("\\^$+?.()|{}[]".includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  source += "$";
  return new RegExp(source);
}

function listMatchingMp4(taskDir, pattern) {
  const matcher = globToRegExp(toPosixPath(pattern));
  const entries = fs.readdirSync(taskDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith(".mp4"))
    .filter((name) => matcher.test(toPosixPath(name)))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(taskDir, name));
}

function runJson(binary, args, label) {
  try {
    const stdout = execFileSync(binary, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 8,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(stdout);
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const detail = stderr ? `\n${stderr}` : "";
    throw new Error(`${label} failed.${detail}`);
  }
}

function probeVideo(file, ffprobeBin) {
  const data = runJson(ffprobeBin, [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    file,
  ], `ffprobe ${file}`);

  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (!video) {
    throw new Error(`${path.basename(file)} has no video stream`);
  }

  const formatDuration = Number.parseFloat(data.format?.duration ?? "");
  const streamDuration = Number.parseFloat(video.duration ?? "");
  const duration = Number.isFinite(formatDuration) ? formatDuration : streamDuration;
  if (!Number.isFinite(duration)) {
    throw new Error(`${path.basename(file)} has no readable duration`);
  }

  return {
    file,
    name: path.basename(file),
    width: Number(video.width),
    height: Number(video.height),
    duration,
    videoCodec: video.codec_name || "unknown",
    audioCodec: audio?.codec_name || "none",
    sizeBytes: Number.parseInt(data.format?.size ?? "0", 10) || 0,
  };
}

function frameHash(file, seconds, ffmpegBin) {
  try {
    const stdout = execFileSync(ffmpegBin, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(seconds),
      "-i",
      file,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-f",
      "framemd5",
      "-",
    ], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 8,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    const last = lines.at(-1);
    if (!last) {
      throw new Error("ffmpeg returned no frame hash");
    }

    return last.split(",").at(-1).trim();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const detail = stderr ? `\n${stderr}` : "";
    throw new Error(`frame hash failed for ${path.basename(file)} at ${seconds}s.${detail}`);
  }
}

function parseSampleTimes(raw) {
  return raw
    .split(",")
    .map((part) => Number.parseFloat(part.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function chooseSampleTimes(raw, minDuration) {
  const requested = parseSampleTimes(raw);
  const maxTime = Math.max(0, minDuration - 0.05);
  const usable = requested.filter((time) => time <= maxTime);
  if (usable.length) return usable;
  return [Math.max(0, minDuration / 2)];
}

function formatBytes(bytes) {
  if (!bytes) return "unknown";
  const mib = bytes / 1024 / 1024;
  return `${mib.toFixed(2)} MiB`;
}

function fail(message) {
  console.error(`[fail] ${message}`);
  process.exitCode = 1;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const taskId = optionValue(options, "--task-id", "--taskId") ?? DEFAULTS.taskId;
  const tasksRoot = path.resolve(optionValue(options, "--tasks-root") ?? "data/tasks");
  const taskDir = path.resolve(optionValue(options, "--task-dir") ?? path.join(tasksRoot, taskId));
  const expectedCount = numberOption(
    options,
    ["--expected-count", "--expected"],
    DEFAULTS.expectedCount,
    "--expected-count",
    { integer: true },
  );
  const pattern = optionValue(options, "--pattern") ?? DEFAULTS.pattern;
  const expectedWidth = numberOption(options, ["--width"], DEFAULTS.width, "--width", { integer: true });
  const expectedHeight = numberOption(options, ["--height"], DEFAULTS.height, "--height", { integer: true });
  const minDuration = numberOption(options, ["--min-duration"], DEFAULTS.minDuration, "--min-duration");
  const durationTolerance = numberOption(
    options,
    ["--duration-tolerance"],
    DEFAULTS.durationTolerance,
    "--duration-tolerance",
  );
  const sampleTimesRaw = optionValue(options, "--sample-times") ?? DEFAULTS.sampleTimes;
  const ffmpegBin = optionValue(options, "--ffmpeg-bin") ?? process.env.FFMPEG_BIN ?? "ffmpeg";
  const ffprobeBin = optionValue(options, "--ffprobe-bin") ?? process.env.FFPROBE_BIN ?? "ffprobe";

  if (expectedCount < 1) {
    throw new Error("--expected-count must be at least 1");
  }
  if (!fs.existsSync(taskDir) || !fs.statSync(taskDir).isDirectory()) {
    throw new Error(`Task directory does not exist: ${taskDir}`);
  }

  console.log(`[info] taskDir: ${taskDir}`);
  console.log(`[info] pattern: ${pattern}`);
  console.log(`[info] expectedCount: ${expectedCount}`);

  const files = listMatchingMp4(taskDir, pattern);
  if (files.length !== expectedCount) {
    const found = files.length ? files.map((file) => `  - ${path.basename(file)}`).join("\n") : "  (none)";
    throw new Error(`Expected ${expectedCount} matched mp4 file(s), found ${files.length}.\n${found}`);
  }

  const probes = files.map((file) => probeVideo(file, ffprobeBin));
  for (const info of probes) {
    if (info.width !== expectedWidth || info.height !== expectedHeight) {
      fail(`${info.name} is ${info.width}x${info.height}, expected ${expectedWidth}x${expectedHeight}`);
    }
    if (info.duration < minDuration) {
      fail(`${info.name} duration ${info.duration.toFixed(3)}s is below ${minDuration}s`);
    }
  }

  const durations = probes.map((info) => info.duration);
  const durationSpread = Math.max(...durations) - Math.min(...durations);
  if (durationSpread > durationTolerance) {
    fail(`variant durations differ by ${durationSpread.toFixed(3)}s, tolerance is ${durationTolerance}s`);
  }

  console.log("[info] probed files:");
  for (const info of probes) {
    console.log(
      `  - ${info.name}: ${info.width}x${info.height}, ` +
      `${info.duration.toFixed(3)}s, video=${info.videoCodec}, ` +
      `audio=${info.audioCodec}, size=${formatBytes(info.sizeBytes)}`,
    );
  }

  if (process.exitCode) return;

  const sampleTimes = chooseSampleTimes(sampleTimesRaw, Math.min(...durations));
  console.log(`[info] frame sample times: ${sampleTimes.map((time) => `${time}s`).join(", ")}`);

  const signatures = new Map();
  for (const file of files) {
    const hashes = sampleTimes.map((time) => frameHash(file, time, ffmpegBin));
    const signature = hashes.join("|");
    signatures.set(path.basename(file), { hashes, signature });
  }

  console.log("[info] sampled frame hashes:");
  for (const [name, { hashes }] of signatures) {
    const formatted = hashes
      .map((hash, index) => `${sampleTimes[index]}s=${hash}`)
      .join(", ");
    console.log(`  - ${name}: ${formatted}`);
  }

  const grouped = new Map();
  for (const [name, { signature }] of signatures) {
    const names = grouped.get(signature) ?? [];
    names.push(name);
    grouped.set(signature, names);
  }

  const duplicateGroups = [...grouped.values()].filter((names) => names.length > 1);
  if (files.length > 1 && duplicateGroups.length) {
    const details = duplicateGroups.map((names) => `  - ${names.join(", ")}`).join("\n");
    fail(`Some variants have identical sampled frame signatures:\n${details}`);
    return;
  }

  console.log(`[ok] ${files.length} mp4 variant(s) passed probe and sampled-frame difference checks.`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
