import { NextResponse } from "next/server";
import { getArtifacts, getTask, patchArtifact, saveArtifact } from "@/lib/pipeline/repo";
import { getLLM } from "@/lib/providers/llm";

type TitlePayload = {
  videoTitles: string[];
  shortTitles: string[];
  hashtags: string[];
  provider: string;
  generatedAt: number;
  ai?: boolean;
};

const RISKY_TITLE_PATTERN = /绝症|重病|癌|肿瘤|恶性|病变|医生说|只剩|剩下|活到.?[\d一二三四五六七八九十百]+岁|多活|寿命|缩小\d|缩小了|康复|痊愈|治愈|自愈|重生|神迹|奇迹好转|逆天改命|暴富/;

function cleanLine(value: unknown, max = 58) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[-\d.、\s]+/, "")
    .trim()
    .slice(0, max);
}

function asList(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/[\n,，、\s]+/).filter(Boolean);
  return [];
}

function stripHashtags(value: string) {
  return value
    .replace(/[#＃][\p{L}\p{N}_\u4e00-\u9fff-]+/gu, "")
    .replace(/\s+/g, " ")
    .replace(/[，,、\s]+$/g, "")
    .trim();
}

function uniqueTitles(values: unknown[], max: number, maxLen: number, rejectRisky = true) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const title = stripHashtags(cleanLine(value, maxLen));
    if (rejectRisky && RISKY_TITLE_PATTERN.test(title)) continue;
    const key = title.replace(/[《》#＃\s，。,.!！?？、]/g, "");
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length >= max) break;
  }
  return out;
}

function cleanHashtag(value: unknown) {
  const raw = String(value || "")
    .replace(/\s+/g, "")
    .replace(/^[-\d.、]+/, "")
    .trim();
  const text = raw.replace(/^[#＃]+/, "").replace(/[^\p{L}\p{N}_\u4e00-\u9fff]/gu, "").slice(0, 16);
  if (!text || RISKY_TITLE_PATTERN.test(text)) return "";
  return `#${text}`;
}

function hashtagsFromTitles(values: unknown[]) {
  const out: string[] = [];
  for (const value of values) {
    const matches = String(value || "").match(/[#＃][\p{L}\p{N}_\u4e00-\u9fff-]+/gu) || [];
    out.push(...matches);
  }
  return out;
}

function uniqueHashtags(values: unknown[], max: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const tag = cleanHashtag(value);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

function fillTitles(primary: string[], fallback: string[], max: number, maxLen: number) {
  return uniqueTitles([...primary, ...fallback], max, maxLen, false);
}

function fillHashtags(primary: string[], fallback: string[], max: number) {
  return uniqueHashtags([...primary, ...fallback], max);
}

function fallbackTitles(input: { bookTitle: string; scriptText: string }): Omit<TitlePayload, "provider" | "generatedAt"> {
  const book = input.bookTitle.replace(/[《》]/g, "").trim() || "这本书";
  const text = input.scriptText;
  const topic = /健康|身体|睡眠|饮食|衰老|疾病|疼痛/.test(text)
    ? "健康"
    : /财富|钱|收入|资产|债务/.test(text)
      ? "认知"
      : /婚姻|家庭|父母|孩子|关系/.test(text)
        ? "关系"
        : "成长";
  return {
    videoTitles: [
      `读《${book}》才懂，真正改变生活的不是鸡血，而是每天的选择`,
      `这本《${book}》适合状态低谷时看，很多问题会突然想明白`,
      `如果你最近总觉得卡住了，可以认真读一遍《${book}》`,
      `《${book}》提醒我的一件事：别把长期问题拖到失控才处理`,
      `把《${book}》读完后，我更确定普通人最该调整的是生活顺序`,
      `这不是一本让人热血的书，而是一本让人慢慢稳定下来的书`,
    ],
    shortTitles: [
      `《${book}》`,
      `先把生活顺序理清`,
      `状态低谷时读这本`,
      `别把问题拖到失控`,
      `普通人也能慢慢变稳`,
      `这本书值得重读`,
    ],
    hashtags: [
      "#读书",
      "#好书推荐",
      "#图书分享",
      "#读书笔记",
      "#深度好书",
      "#书单",
      "#每日读书",
      "#自我提升",
      "#认知成长",
      "#成长",
      `#${topic}`,
      "#人生感悟",
      "#生活方式",
      "#情绪价值",
      "#个人成长",
      "#知识分享",
      "#视频号运营",
      "#短视频文案",
      "#中年成长",
      "#普通人的成长",
      "#女性成长",
      "#男性成长",
      "#亲子教育",
      "#家庭关系",
      "#情绪管理",
      "#心理成长",
      "#长期主义",
      "#普通人逆袭",
      "#成长思维",
      "#阅读分享",
      "#书摘",
      "#每天一本书",
      `#${book.slice(0, 12)}`,
    ],
  };
}

function parseJsonObject(raw: string) {
  const text = raw.trim();
  try { return JSON.parse(text); } catch { /* try fenced or embedded json */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try { return JSON.parse(fenced); } catch { /* ignore */ }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* ignore */ }
  }
  return null;
}

function buildPrompt(input: {
  bookTitle: string;
  bookAuthor: string;
  sourceTitle: string;
  scriptText: string;
}) {
  const script = input.scriptText.replace(/\s+/g, " ").slice(0, 3600);
  return {
    system: `你是视频号图书短视频的标题策划。请根据书名、原视频标题和口播稿，生成不像模板、适合点击和转发的中文标题。

要求：
- 输出严格 JSON：{"video_titles":["..."],"short_titles":["..."],"hashtags":["..."]}。
- video_titles 生成 8 条，适合视频号发布，但不要包含 #话题。
- short_titles 生成 6 条，适合封面大字，2-12 个中文字符为主。
- hashtags 生成 18-28 个，必须单独列出，每个都以 # 开头，包含图书/读书/成长/情绪/生活方式/账号定位/这条内容具体卖点等方向。
- 标题要基于这条口播的具体卖点，不要只套“读完才明白/这本书讲透/越早读越受益”等固定句式。
- 不要夸大疗效，不要承诺治愈、康复、暴富、逆天改命。
- 避免把严重疾病、肿瘤、绝症、重病、医生诊断、寿命数字、病情改善比例、重生等词写进标题；这类内容应转译成“低谷、状态、内心对话、长期选择、生活秩序”等安全表达。
- 不要出现党政、医疗诊断、绝对化保证。
- 长标题尽量有不同结构：提问、反常识、场景痛点、读后收获、行动提醒、金句改写。
- 保留书名时使用《书名》，不要编造作者或不存在的事实。
- 只输出 json，不要 markdown。`,
    user: `书名：${input.bookTitle || "未知"}
作者：${input.bookAuthor || "未知"}
原视频标题：${input.sourceTitle || ""}

口播稿摘录：
${script}`,
  };
}

function saveTitlePayload(taskId: string, currentMeta: any, payload: TitlePayload) {
  const meta = {
    ...currentMeta,
    video_titles: payload.videoTitles,
    short_titles: payload.shortTitles,
    hashtags: payload.hashtags,
    title_provider: payload.provider,
    title_generated_at: payload.generatedAt,
    saved_at: currentMeta.saved_at || payload.generatedAt,
  };
  const existing = getArtifacts(taskId).find((a) => a.stepName === "rewrite" && a.kind === "json");
  if (existing) {
    patchArtifact(existing.id, {
      label: existing.label || "书籍信息",
      meta: JSON.stringify(meta),
    });
  } else {
    saveArtifact({
      taskId,
      stepName: "rewrite",
      kind: "json",
      label: "书籍信息",
      meta,
    });
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const arts = getArtifacts(id);
  const bookMeta = (() => {
    const raw = arts.find((a) => a.stepName === "rewrite" && a.kind === "json")?.meta;
    if (!raw) return {} as any;
    try { return JSON.parse(raw); } catch { return {} as any; }
  })();
  const scriptText =
    arts.find((a) => a.stepName === "rewrite" && a.kind === "rewrite")?.content ||
    arts.find((a) => a.stepName === "transcribe" && a.kind === "cleaned")?.content ||
    task.title ||
    "";
  const bookTitle = task.bookTitle || bookMeta.book_title || "";
  const bookAuthor = task.bookAuthor || bookMeta.book_author || "";
  const fallback = fallbackTitles({ bookTitle: bookTitle || task.title || "这本书", scriptText });
  const llm = getLLM();

  try {
    const prompt = buildPrompt({
      bookTitle,
      bookAuthor,
      sourceTitle: task.title || "",
      scriptText,
    });
    const raw = await llm.chat({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.9,
      json: true,
    });
    const json = parseJsonObject(raw) || {};
    const rawVideoTitles = asList(json.video_titles || json.videoTitles);
    const rawShortTitles = asList(json.short_titles || json.shortTitles);
    const rawHashtags = asList(json.hashtags || json.hashTags || json.topics);
    const videoTitles = uniqueTitles(rawVideoTitles, 8, 86);
    const shortTitles = uniqueTitles(rawShortTitles, 6, 18);
    const hashtags = uniqueHashtags([
      ...rawHashtags,
      ...hashtagsFromTitles(rawVideoTitles),
    ], 28);
    const payload = {
      ok: true,
      ai: true,
      videoTitles: fillTitles(videoTitles, fallback.videoTitles, 8, 86),
      shortTitles: fillTitles(shortTitles, fallback.shortTitles, 6, 18),
      hashtags: fillHashtags(hashtags, fallback.hashtags, 28),
      provider: llm.name,
      generatedAt: Date.now(),
    } satisfies TitlePayload & { ok: true };
    saveTitlePayload(id, bookMeta, payload);
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({
      ok: true,
      ai: false,
      ...fallback,
      provider: `fallback:${llm.name}`,
      generatedAt: Date.now(),
      warning: String(e?.message || e).slice(0, 240),
    });
  }
}
