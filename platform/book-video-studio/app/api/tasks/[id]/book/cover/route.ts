import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getArtifacts, getTask, patchArtifact, saveArtifact, taskDir } from "@/lib/pipeline/repo";
import { getImage } from "@/lib/providers/image";

const COVER_TIMEOUT_MS = Math.max(60_000, Math.min(420_000, Number(process.env.IMAGE_COVER_TIMEOUT_MS) || 300_000));
const COVER_SIZE = process.env.IMAGE_COVER_SIZE?.trim() || "1024x1536";
const COVER_STYLES: Record<string, { label: string; prompt: string }> = {
  celestial: {
    label: "灵性星光",
    prompt: "Style: spiritual celestial minimalism. Deep midnight blue and warm gold, soft vertical light, quiet star field, luminous open book or subtle paper texture, refined negative space, premium philosophical nonfiction cover.",
  },
  editorial: {
    label: "水墨文学",
    prompt: "Style: modern literary editorial. Cream paper texture, restrained black ink abstract lines, calm bookstore nonfiction aesthetic, elegant and understated, premium Chinese typography.",
  },
  cinematic: {
    label: "电影写作桌",
    prompt: "Style: cinematic photoreal concept cover. A quiet writing desk before dawn, notebook and pen, warm mysterious light, floating dust, introspective realistic photography adapted into a book jacket.",
  },
  abstract: {
    label: "抽象几何",
    prompt: "Style: abstract metaphysical poster. Luminous circle, thin gold geometry, symbolic waveforms, dark textured stone-paper background, museum-poster quality, bold minimal composition.",
  },
};

function safeSlug(value: string) {
  const ascii = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return ascii || "book";
}

function publicFileUrl(filePath: string) {
  const rel = path.relative(process.cwd(), filePath).replace(/^\.?\/?data\//, "");
  return "/api/files/" + rel.split(path.sep).map(encodeURIComponent).join("/");
}

function parseMeta(raw: string | null | undefined) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function coverPrompt(input: { title: string; author: string; style: string }) {
  return `Create an original Chinese book cover concept.

Book title text must be exactly: ${input.title || "书名"}
Author text must be exactly: ${input.author || "作者"}

Requirements:
- Portrait book-cover aspect ratio.
- Premium published book jacket design.
- Clear, legible Chinese title typography.
- No watermark, no QR code, no publisher logo, no barcode.
- Do not imitate or reproduce any existing real book cover.
- Avoid extra readable text beyond the title and author.

${COVER_STYLES[input.style]?.prompt || COVER_STYLES.celestial.prompt}

Only generate the cover image.`;
}

function normalizeStyles(body: any): string[] {
  const requested = Array.isArray(body.styles)
    ? body.styles
    : body.allStyles || body.style === "all"
      ? Object.keys(COVER_STYLES)
      : [body.style || "celestial"];
  const styles = requested
    .map((style: unknown) => String(style || "").trim())
    .filter((style: string) => COVER_STYLES[style]);
  return Array.from(new Set(styles.length ? styles : ["celestial"]));
}

function mergeCandidates(prev: unknown, next: any[]) {
  const candidates = Array.isArray(prev) ? prev.filter(Boolean) : [];
  const seen = new Set<string>();
  return [...next, ...candidates]
    .filter((item: any) => {
      const url = String(item?.url || "");
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, 24);
}

function normalizeForCompare(value: unknown) {
  return String(value || "").replace(/[《》\s,，。:：#"'“”‘’\[\]【】]/g, "").trim();
}

function selectCoverTitle(input: { requested: unknown; bookTitle: unknown; sourceTitle: unknown }) {
  const requested = String(input.requested || "").trim();
  const bookTitle = String(input.bookTitle || "").trim();
  const sourceTitle = String(input.sourceTitle || "").trim();
  if (!requested) return bookTitle || sourceTitle || "书名";
  const requestedKey = normalizeForCompare(requested);
  const bookKey = normalizeForCompare(bookTitle);
  const looksLikeSourceTitle = !!bookTitle && requestedKey.includes(bookKey) && (
    requested.length > bookTitle.length + 8 ||
    requested.includes("#") ||
    requested.includes("\n")
  );
  return looksLikeSourceTitle ? bookTitle : requested;
}

function selectCoverAuthor(input: { requested: unknown; bookAuthor: unknown; sourceAuthor: unknown }) {
  const requested = String(input.requested || "").trim();
  const bookAuthor = String(input.bookAuthor || "").trim();
  const sourceAuthor = String(input.sourceAuthor || "").trim();
  if (!requested) return bookAuthor || "作者";
  if (bookAuthor && sourceAuthor && normalizeForCompare(requested) === normalizeForCompare(sourceAuthor)) {
    return bookAuthor;
  }
  return requested;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const styles = normalizeStyles(body);
  const title = selectCoverTitle({
    requested: body.bookTitle,
    bookTitle: task.bookTitle,
    sourceTitle: task.title,
  });
  const author = selectCoverAuthor({
    requested: body.bookAuthor,
    bookAuthor: task.bookAuthor,
    sourceAuthor: task.author,
  });

  const dir = taskDir(id);
  const provider = getImage();
  const covers: any[] = [];
  const errors: any[] = [];
  for (const style of styles) {
    const fileName = `book-cover-${safeSlug(style)}-${Date.now()}.png`;
    const outPath = path.join(dir, fileName);
    try {
      const generated = await provider.generate(coverPrompt({ title, author, style }), outPath, {
        size: COVER_SIZE,
        timeoutMs: COVER_TIMEOUT_MS,
      });
      fs.statSync(outPath);
      covers.push({
        label: COVER_STYLES[style]?.label || style,
        url: publicFileUrl(outPath),
        path: path.relative(process.cwd(), outPath),
        provider: generated.provider || provider.name,
        style,
        generatedAt: Date.now(),
      });
    } catch (error: any) {
      errors.push({
        style,
        label: COVER_STYLES[style]?.label || style,
        error: String(error?.message || error).slice(0, 300),
      });
    }
  }

  if (!covers.length) {
    return NextResponse.json({
      error: errors[0]?.error || "封面生成失败",
      errors,
    }, { status: 500 });
  }

  const coverUrl = covers[0]?.url || "";
  const coverPath = covers[0]?.path || "";
  const coverProvider = covers[0]?.provider || provider.name;
  const coverStyle = covers[0]?.style || styles[0] || "celestial";
  const existing = getArtifacts(id).find((a) => a.stepName === "rewrite" && a.kind === "json");
  const existingMeta = parseMeta(existing?.meta);
  const metaPatch = {
    book_title: title,
    book_author: author,
    cover_url: coverUrl,
    cover_path: coverPath,
    cover_provider: coverProvider,
    cover_style: coverStyle,
    cover_generated_at: Date.now(),
    cover_candidates: mergeCandidates(existingMeta.cover_candidates, covers),
  };

  if (existing) {
    patchArtifact(existing.id, {
      label: existing.label || "书籍信息",
      meta: JSON.stringify({ ...existingMeta, ...metaPatch }),
    });
  } else {
    saveArtifact({
      taskId: id,
      stepName: "rewrite",
      kind: "json",
      label: "书籍信息",
      meta: {
        ...metaPatch,
        confidence: title ? 0.98 : 0,
        evidence: "AI 生成封面时创建",
      },
    });
  }

  return NextResponse.json({
    ok: true,
    coverUrl,
    covers,
    path: coverPath,
    provider: coverProvider,
    style: coverStyle,
    errors,
  });
}
