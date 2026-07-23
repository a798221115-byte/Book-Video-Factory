import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getArtifacts, getTask, saveArtifact, taskDir } from "@/lib/pipeline/repo";
import { getImage } from "@/lib/providers/image";

const VIDEO_COVER_TIMEOUT_MS = Math.max(60_000, Math.min(420_000, Number(process.env.IMAGE_VIDEO_COVER_TIMEOUT_MS) || 300_000));
const VIDEO_COVER_SIZE = process.env.IMAGE_VIDEO_COVER_SIZE?.trim() || "1024x1792";

function parseMeta(raw: string | null | undefined) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function safeSlug(value: string) {
  const ascii = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return ascii || "video-cover";
}

function textPreview(value: unknown, max = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function videoCoverPrompt(input: {
  title: string;
  author: string;
  hook: string;
  theme: string;
}) {
  return `Create a vertical 9:16 first-frame image for a Chinese short video about a book.

Book title: ${input.title || "图书分享"}
Author: ${input.author || ""}
Opening hook/theme: ${input.hook || input.theme || "一个值得认真听完的观点"}

Visual direction:
- Premium nonfiction short-video cover frame, cinematic but clear.
- Strong central subject, simple readable composition, high contrast, mobile-first.
- Leave clean negative space in the upper third and lower third for app-rendered Chinese title overlays.
- Use symbolic reading, desk, paper, window light, human silhouette, or life-detail imagery.
- No readable text inside the image, no subtitles, no book title text, no watermark, no logo, no QR code.
- Avoid medical gore, hospital beds, surgical rooms, distorted hands, close-up faces, plastic AI texture.
- The image should work as the first frame before the video starts, not as a printed book cover.

Only generate the image.`;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const arts = getArtifacts(id);
  const bookMeta = parseMeta(arts.find((a) => a.stepName === "rewrite" && a.kind === "json")?.meta);
  const rewriteText = arts.find((a) => a.stepName === "rewrite" && a.kind === "rewrite")?.content || "";
  const segmentsMeta = parseMeta(arts.find((a) => a.stepName === "rewrite" && a.kind === "segments")?.meta);
  const firstSegment = Array.isArray(segmentsMeta.segments) ? segmentsMeta.segments[0]?.text : "";
  const title = String(body.title || task.bookTitle || bookMeta.book_title || task.title || "").trim();
  const author = String(body.author || task.bookAuthor || bookMeta.book_author || task.author || "").trim();
  const hook = textPreview(body.hook || firstSegment || rewriteText, 180);

  const dir = taskDir(id);
  const provider = getImage();
  const fileName = `video-cover-${safeSlug(title)}-${Date.now()}.png`;
  const outPath = path.join(dir, fileName);

  try {
    const generated = await provider.generate(videoCoverPrompt({
      title,
      author,
      hook,
      theme: textPreview(task.title || rewriteText, 120),
    }), outPath, {
      size: VIDEO_COVER_SIZE,
      timeoutMs: VIDEO_COVER_TIMEOUT_MS,
    });
    const stat = fs.statSync(outPath);
    if (stat.size <= 0) throw new Error("首页图为空文件");
    const artifactId = saveArtifact({
      taskId: id,
      stepName: "images",
      kind: "video_cover",
      label: "视频首页图",
      path: path.relative(process.cwd(), outPath),
      meta: {
        title,
        author,
        hook,
        provider: generated.provider || provider.name,
        size: VIDEO_COVER_SIZE,
        role: "first-frame",
        generatedAt: Date.now(),
      },
    });
    return NextResponse.json({
      ok: true,
      artifactId,
      path: path.relative(process.cwd(), outPath),
      provider: generated.provider || provider.name,
      size: VIDEO_COVER_SIZE,
    });
  } catch (error: any) {
    try { fs.unlinkSync(outPath); } catch {}
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
