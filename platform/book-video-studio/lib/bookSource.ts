import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { getBookLLM } from "./providers/llm";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip");

export type BookSourceParagraph = {
  id: string;
  text: string;
  chapter: string;
  location: string;
};

export type BookSourceCandidate = BookSourceParagraph & {
  count: null;
  sourceType: "uploaded_epub";
  sourceFile: string;
  relevanceScore: number;
  relevanceReason: string;
  connection: string;
};

type ParsedEpub = {
  title: string;
  author: string;
  paragraphs: BookSourceParagraph[];
};

function parseJsonObject(raw: string) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    middot: "·",
    nbsp: " ",
    ndash: "–",
    quot: "\"",
    rdquo: "”",
    rsquo: "’",
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => named[String(name).toLowerCase()] ?? match);
}

function htmlToText(value: string) {
  return decodeEntities(
    value
      .replace(/<(script|style|svg|nav)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|li|blockquote|h[1-6]|div|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function xmlValue(xml: string, tagName: string) {
  const match = xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? htmlToText(match[1]) : "";
}

function tagAttributes(tag: string) {
  const output: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) {
    output[match[1]] = decodeEntities(match[2]);
  }
  return output;
}

function splitLongParagraph(text: string, maxLength = 650) {
  if (text.length <= maxLength) return [text];
  const sentences = text.split(/(?<=[。！？!?；;])/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxLength) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text.slice(0, maxLength)];
}

export function parseEpubBuffer(buffer: Buffer): ParsedEpub {
  const zip = new AdmZip(buffer);
  const entries = new Map<string, any>(
    zip.getEntries().map((entry: any) => [String(entry.entryName).replaceAll("\\", "/"), entry]),
  );
  const container = entries.get("META-INF/container.xml");
  if (!container) throw new Error("EPUB 缺少 META-INF/container.xml");
  const containerXml = container.getData().toString("utf8");
  const rootfile = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!rootfile) throw new Error("EPUB 未声明 OPF 内容文件");
  const opfEntry = entries.get(rootfile);
  if (!opfEntry) throw new Error(`EPUB 中找不到 ${rootfile}`);
  const opfXml = opfEntry.getData().toString("utf8");
  const opfDir = path.posix.dirname(rootfile);
  const manifest = new Map<string, { href: string; mediaType: string }>();
  for (const match of opfXml.matchAll(/<item\b[^>]*\/?>/gi)) {
    const attrs = tagAttributes(match[0]);
    if (!attrs.id || !attrs.href) continue;
    manifest.set(attrs.id, {
      href: attrs.href.split("#")[0],
      mediaType: attrs["media-type"] || "",
    });
  }
  const spineIds = Array.from<RegExpMatchArray>(opfXml.matchAll(/<itemref\b[^>]*\/?>/gi))
    .map((match) => tagAttributes(match[0]).idref)
    .filter(Boolean);
  const orderedItems = spineIds
    .map((id) => manifest.get(id))
    .filter((item): item is { href: string; mediaType: string } => Boolean(item))
    .filter((item) => /xhtml|html/i.test(item.mediaType) || /\.x?html?$/i.test(item.href));
  const contentItems = orderedItems.length
    ? orderedItems
    : Array.from(manifest.values()).filter((item) => /xhtml|html/i.test(item.mediaType));

  const paragraphs: BookSourceParagraph[] = [];
  const seen = new Set<string>();
  let currentChapter = "";
  for (const item of contentItems) {
    const entryName = path.posix.normalize(path.posix.join(opfDir, decodeURIComponent(item.href)));
    const entry = entries.get(entryName);
    if (!entry) continue;
    const html = entry.getData().toString("utf8");
    const heading = htmlToText(
      html.match(/<(?:h1|h2|h3)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|h3)>/i)?.[1] || "",
    );
    const documentTitle = htmlToText(
      html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "",
    );
    if (heading && !/^(未知|unknown)$/i.test(heading)) currentChapter = heading;
    const chapter = currentChapter
      || (!/^(未知|unknown)$/i.test(documentTitle) ? documentTitle : "")
      || path.posix.basename(entryName);
    const blocks = Array.from<RegExpMatchArray>(
      html.matchAll(/<(?:p|li|blockquote)\b[^>]*>([\s\S]*?)<\/(?:p|li|blockquote)>/gi),
    ).map((match) => htmlToText(match[1]));
    const usableBlocks = blocks.length ? blocks : htmlToText(html).split(/\n+/);
    let blockIndex = 0;
    for (const raw of usableBlocks) {
      for (const text of splitLongParagraph(raw.trim())) {
        if (text.length < 24 || /^[\d\s.,，。:：;；·—\-]+$/.test(text)) continue;
        const normalized = text.replace(/\s+/g, "");
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        const id = createHash("sha1")
          .update(`${entryName}:${blockIndex}:${text}`)
          .digest("hex")
          .slice(0, 16);
        paragraphs.push({
          id,
          text,
          chapter,
          location: `${entryName}#paragraph-${blockIndex + 1}`,
        });
        blockIndex += 1;
      }
    }
  }
  if (!paragraphs.length) throw new Error("EPUB 中没有解析出可分析的正文段落");
  return {
    title: xmlValue(opfXml, "dc:title"),
    author: xmlValue(opfXml, "dc:creator"),
    paragraphs,
  };
}

function localRelevanceScore(paragraph: BookSourceParagraph, terms: string[]) {
  const text = paragraph.text.toLowerCase().replace(/\s+/g, "");
  let score = 0;
  for (const term of terms) {
    const normalized = term.toLowerCase().replace(/\s+/g, "");
    if (normalized.length < 2) continue;
    const occurrences = text.split(normalized).length - 1;
    if (occurrences > 0) score += occurrences * Math.min(12, normalized.length * 2);
    for (let index = 0; index < normalized.length - 1; index += 1) {
      if (text.includes(normalized.slice(index, index + 2))) score += 0.35;
    }
  }
  return score;
}

export async function findRelevantBookPassages(input: {
  parsed: ParsedEpub;
  sourceFile: string;
  bookTitle: string;
  bookAuthor: string;
  cleanedTranscript: string;
  viralStructure: string;
  limit?: number;
}) {
  const llm = getBookLLM();
  const themeRaw = await llm.chat({
    system: `你是图书证据检索编辑。根据短视频爆款参考稿和结构分析，提取用于原书检索的主题、冲突、关系、动作和同义表达。不得代写文案。

必须填写具体内容，themes、keywords、related_expressions 各至少 5 项，禁止返回空字符串或空数组。
严格输出 json：
{
  "summary":"一句具体的检索摘要",
  "themes":["主题1","主题2"],
  "keywords":["关键词1","关键词2"],
  "related_expressions":["相关表达1","相关表达2"]
}`,
    user: `目标图书：《${input.bookTitle}》
作者：${input.bookAuthor}

参考视频清洗稿：
${input.cleanedTranscript.slice(0, 8000)}

爆款结构分析：
${input.viralStructure.slice(0, 6000)}

请输出 json，用于从用户上传的原书 EPUB 中检索内容相关、观点相近或能支撑同一冲突的原文。`,
    temperature: 0.15,
    json: true,
  });
  const themes = parseJsonObject(themeRaw);
  const terms = [
    ...(Array.isArray(themes.themes) ? themes.themes : []),
    ...(Array.isArray(themes.keywords) ? themes.keywords : []),
    ...(Array.isArray(themes.related_expressions) ? themes.related_expressions : []),
  ].map(String).filter(Boolean);
  if (!terms.length) throw new Error("DeepSeek 未返回可用的原书检索主题");

  const shortlist = input.parsed.paragraphs
    .map((paragraph) => ({ paragraph, score: localRelevanceScore(paragraph, terms) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 90);
  const payloadParts: string[] = [];
  let payloadLength = 0;
  for (const item of shortlist) {
    const block = `ID: ${item.paragraph.id}\n章节: ${item.paragraph.chapter}\n原文: ${item.paragraph.text}\n`;
    if (payloadLength + block.length > 48_000) break;
    payloadParts.push(block);
    payloadLength += block.length;
  }

  const rankingRaw = await llm.chat({
    system: `你是严谨的原书证据筛选编辑。只能从用户上传 EPUB 的候选段落中选择，不得改写、拼接或补造原文。

筛选目标：
1. 与参考爆款稿表达相同、相近或存在清晰逻辑联系；
2. 能支持二创稿的核心冲突、转折或观点；
3. 优先完整、有独立含义、适合短视频引用或概述的段落；
4. 相关度不足的不要硬选。

严格输出 json：
{
  "matches":[
    {
      "id":"候选ID",
      "score":0,
      "reason":"为什么与参考内容相关",
      "connection":"可支撑二创稿的哪个观点或转折"
    }
  ]
}

score 为 0-100。最多选择 20 条，按相关度从高到低排列。每个字段必须填写具体内容，禁止返回空 ID、空理由或空联系。`,
    user: `检索主题：
${JSON.stringify(themes)}

候选原书段落：
${payloadParts.join("\n")}

仅输出 json。`,
    temperature: 0.1,
    json: true,
  });
  const ranking = parseJsonObject(rankingRaw);
  const paragraphMap = new Map(input.parsed.paragraphs.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const rawMatches: any[] = Array.isArray(ranking.matches) ? ranking.matches : [];
  const matches = rawMatches
    .map((match: any): BookSourceCandidate | null => {
      const paragraph = paragraphMap.get(String(match.id || ""));
      if (!paragraph || seen.has(paragraph.id)) return null;
      seen.add(paragraph.id);
      return {
        ...paragraph,
        count: null,
        sourceType: "uploaded_epub" as const,
        sourceFile: input.sourceFile,
        relevanceScore: Math.max(0, Math.min(100, Number(match.score || 0))),
        relevanceReason: String(match.reason || "").trim(),
        connection: String(match.connection || "").trim(),
      };
    })
    .filter((item): item is BookSourceCandidate => Boolean(item))
    .slice(0, Math.min(20, Math.max(1, input.limit || 20)));
  if (!matches.length) throw new Error("DeepSeek 没有从原书中筛选出可靠的相关段落");
  return {
    themes,
    candidates: matches,
    paragraphCount: input.parsed.paragraphs.length,
    epubTitle: input.parsed.title,
    epubAuthor: input.parsed.author,
  };
}

export function writeParsedBookSourceAudit(
  directory: string,
  parsed: ParsedEpub,
  result: Awaited<ReturnType<typeof findRelevantBookPassages>>,
) {
  fs.mkdirSync(directory, { recursive: true });
  const paragraphsPath = path.join(directory, "extracted-paragraphs.json");
  const matchesPath = path.join(directory, "deepseek-matches.json");
  fs.writeFileSync(paragraphsPath, JSON.stringify({
    title: parsed.title,
    author: parsed.author,
    paragraphCount: parsed.paragraphs.length,
    paragraphs: parsed.paragraphs,
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(matchesPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  return { paragraphsPath, matchesPath };
}
