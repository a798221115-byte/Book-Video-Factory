import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "@/lib/pipeline/repo";

const DATA_DIR = process.env.DATA_DIR || "./data";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg",
  ".srt": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
};

// 提供 data 目录下的产物文件（带 Range 支持，便于音视频拖动）
export async function GET(req: NextRequest, ctx: { params: Promise<{ p: string[] }> }) {
  const { p } = await ctx.params;
  // 正式生产产物只允许从项目 work/ 读取；旧任务仍可读取 data/。
  const isWorkArtifact = p[0] === "work";
  const root = isWorkArtifact ? path.resolve(PROJECT_ROOT) : path.resolve(DATA_DIR);
  const allowedRoot = isWorkArtifact ? path.resolve(PROJECT_ROOT, "work") : root;
  const target = path.resolve(root, ...p);
  if (target !== allowedRoot && !target.startsWith(allowedRoot + path.sep)) {
    return new Response("forbidden", { status: 403 });
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return new Response("not found", { status: 404 });

  const stat = fs.statSync(target);
  const ext = path.extname(target).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const range = req.headers.get("range");

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    const chunk = fs.readFileSync(target).subarray(start, end + 1);
    return new Response(chunk, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunk.length),
      },
    });
  }

  return new Response(fs.readFileSync(target), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes",
      "Content-Length": String(stat.size),
    },
  });
}
