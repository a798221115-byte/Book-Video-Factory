import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node download_douyin_tikhub.mjs --url <douyin-url> --output <reference.mp4> --metadata <metadata.json>",
    "",
    "Environment:",
    "  TIKHUB_API_KEY   Required TikHub bearer token",
    "  TIKHUB_BASE_URL  Optional; defaults to https://api.tikhub.io",
  ].join("\n");
}

function requireValue(value, name) {
  if (!value || value === true) throw new Error(`Missing --${name}\n${usage()}`);
  return value;
}

async function withRetry(fn, tries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < tries) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function resolveAwemeId(sourceUrl) {
  const direct = sourceUrl.match(/(?:video\/|modal_id=)(\d{15,})/);
  if (direct) return direct[1];
  const response = await fetch(sourceUrl, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (iPhone)" },
  });
  if (!response.ok) throw new Error(`Douyin redirect ${response.status}`);
  const match = response.url.match(/(?:video\/|modal_id=)(\d{15,})/);
  if (!match) throw new Error(`Cannot resolve aweme_id from redirected URL: ${response.url}`);
  return match[1];
}

function pickVideoUrl(detail) {
  return detail?.video?.play_addr?.url_list?.[0]
    ?? detail?.video?.download_addr?.url_list?.[0]
    ?? "";
}

function normalizeDetail(payload) {
  return payload?.data?.aweme_detail ?? payload?.data ?? payload;
}

async function fetchTikHubDetail(baseUrl, apiKey, awemeId) {
  const apiPath = `/api/v1/douyin/web/fetch_one_video?aweme_id=${encodeURIComponent(awemeId)}`;
  const response = await fetch(`${baseUrl}${apiPath}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`TikHub ${response.status}: ${text.slice(0, 500)}`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`TikHub returned non-JSON data: ${text.slice(0, 500)}`);
  }
  const detail = normalizeDetail(payload);
  const videoUrl = pickVideoUrl(detail);
  if (!detail || !videoUrl) throw new Error("TikHub response does not contain a usable Douyin video URL");
  return { apiPath, detail, videoUrl };
}

async function sha256(filePath) {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const sourceUrl = requireValue(args.url, "url");
  const outputPath = path.resolve(requireValue(args.output, "output"));
  const metadataPath = path.resolve(requireValue(args.metadata, "metadata"));
  const apiKey = process.env.TIKHUB_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing TIKHUB_API_KEY; TikHub download is required and no fallback will be used");
  const baseUrl = (process.env.TIKHUB_BASE_URL?.trim() || "https://api.tikhub.io").replace(/\/+$/, "");

  for (const target of [outputPath, metadataPath]) {
    try {
      await fs.access(target);
      throw new Error(`Refusing to overwrite existing file: ${target}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  const awemeId = await resolveAwemeId(sourceUrl);
  const { apiPath, detail, videoUrl } = await withRetry(
    () => fetchTikHubDetail(baseUrl, apiKey, awemeId),
    3,
  );

  const partialPath = `${outputPath}.part`;
  const videoResponse = await withRetry(async () => {
    const response = await fetch(videoUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://www.douyin.com/",
      },
    });
    if (!response.ok) throw new Error(`TikHub video download ${response.status}`);
    return response;
  }, 3);
  const videoBytes = Buffer.from(await videoResponse.arrayBuffer());
  if (videoBytes.length < 1024) throw new Error(`Downloaded video is unexpectedly small: ${videoBytes.length} bytes`);
  await fs.writeFile(partialPath, videoBytes);
  await fs.rename(partialPath, outputPath);

  const metadata = {
    provider: "TikHub",
    sourceUrl,
    awemeId,
    title: detail?.desc ?? "",
    author: detail?.author?.nickname ?? "",
    coverUrl: detail?.video?.cover?.url_list?.[0] ?? "",
    stats: {
      plays: detail?.statistics?.play_count,
      likes: detail?.statistics?.digg_count,
      comments: detail?.statistics?.comment_count,
      shares: detail?.statistics?.share_count,
      followers: detail?.author?.follower_count,
      durationMs: detail?.video?.duration,
      publishedAtUnix: detail?.create_time,
    },
    apiPath,
    downloadedAt: new Date().toISOString(),
    outputPath,
    bytes: videoBytes.length,
    sha256: await sha256(outputPath),
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(metadata, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
