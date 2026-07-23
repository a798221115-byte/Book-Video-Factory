import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getArtifacts, getTask, patchArtifact, saveArtifact, taskDir, updateTask } from "@/lib/pipeline/repo";
import { getLLM } from "@/lib/providers/llm";
import type { TitleCandidate } from "@/lib/titleWorkflow";

const FORMULAS = [
  { id: 1, trigger: "认知冲突", template: "为什么 [每个人都觉得很好的事] 其实对你有害？", example: "为什么喝牛奶其实对你一点也不好？" },
  { id: 7, trigger: "好奇缺口", template: "[一群人] 不会告诉你的建议", example: "会赚钱的博主不会告诉你的建议" },
  { id: 12, trigger: "好奇缺口", template: "看完这个，你的 [想法] 会不再相同", example: "看完这个，你的思维模式会不再相同" },
  { id: 14, trigger: "损失规避", template: "[不想要的结果] 的最根本原因", example: "减肥不成功的最根本原因" },
  { id: 23, trigger: "身份代入", template: "给 [一群人] 的一个忠告", example: "给 30+ 正经历迷茫的创业者们的一段话" },
  { id: 42, trigger: "反转叙事", template: "从 [经历] 中学到的最重要的教训", example: "从年入 7 位数到公司破产，我学到的最重要的教训" },
  { id: 54, trigger: "争议挑衅", template: "停止 [行动]！！开始 [行动]！！", example: "停止学习！！开始实践！！" },
  { id: 56, trigger: "场景条件", template: "如果你 [抗拒] [抗拒] [抗拒]，如何解决 [问题]", example: "如果你没有经验，没有团队，没有专业技能，如何在充满噪音的互联网上出彩？" },
] as const;

function parseJson(raw: string) {
  const text = raw.trim();
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try { return JSON.parse(fenced); } catch {}
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return {};
}

function readMeta(taskId: string) {
  const artifact = getArtifacts(taskId).find((item) => item.stepName === "rewrite" && item.kind === "json");
  if (!artifact?.meta) return {};
  try { return JSON.parse(artifact.meta); } catch { return {}; }
}

function writeMeta(taskId: string, meta: Record<string, any>) {
  const artifact = getArtifacts(taskId).find((item) => item.stepName === "rewrite" && item.kind === "json");
  if (artifact) {
    patchArtifact(artifact.id, { label: artifact.label || "书籍信息", meta: JSON.stringify(meta) });
  } else {
    saveArtifact({ taskId, stepName: "rewrite", kind: "json", label: "书籍信息", meta });
  }
  fs.writeFileSync(path.join(taskDir(taskId), "titles.json"), JSON.stringify({
    sourceTitle: meta.title_source_title || "",
    sourceLength: meta.title_source_length || 0,
    formulaSkill: meta.title_skill || "dbs-xhs-title",
    stage: meta.title_stage || "idle",
    longCandidates: meta.long_title_candidates || [],
    selectedLongTitle: meta.selected_long_title || "",
    shortCandidates: meta.short_title_candidates || [],
    selectedShortTitle: meta.selected_short_title || "",
    hashtags: meta.hashtags || [],
    updatedAt: Date.now(),
  }, null, 2), "utf8");
  const gateByStage: Record<string, string> = {
    long_pending: "LONG_TITLE_CONFIRMATION",
    long_confirmed: "SHORT_TITLE_GENERATION",
    short_pending: "SHORT_TITLE_CONFIRMATION",
    complete: "STYLE_SAMPLE_CONFIRMATION",
  };
  if (gateByStage[meta.title_stage]) updateTask(taskId, { currentGate: gateByStage[meta.title_stage] });
}

function cleanTitle(value: unknown, maxLength: number) {
  return String(value || "")
    .replace(/[#＃][\p{L}\p{N}_\u4e00-\u9fff-]+/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^[-\d.、\s]+/, "")
    .replace(/[，,、\s]+$/g, "")
    .trim()
    .slice(0, maxLength);
}

function uniqueCandidates(values: unknown, max: number, maxLength: number): TitleCandidate[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: TitleCandidate[] = [];
  for (const [index, raw] of values.entries()) {
    const item = typeof raw === "string" ? { text: raw } : (raw || {});
    const text = cleanTitle((item as any).text || (item as any).title, maxLength);
    const key = text.replace(/[《》\s，。,.!！?？、]/g, "");
    if (!text || seen.has(key)) continue;
    seen.add(key);
    const formulaId = Number((item as any).formula_id || (item as any).formulaId || 0);
    const formula = FORMULAS.find((entry) => entry.id === formulaId);
    result.push({
      id: String((item as any).id || `${formulaId || "short"}-${index + 1}`),
      text,
      ...(formula ? {
        formulaId: formula.id,
        trigger: formula.trigger,
        formulaTemplate: formula.template,
        originalExample: formula.example,
        reason: cleanTitle((item as any).reason, 120),
      } : {}),
    });
    if (result.length >= max) break;
  }
  return result;
}

function longFallback(sourceTitle: string, bookTitle: string): TitleCandidate[] {
  const source = cleanTitle(sourceTitle, 72) || `读完《${bookTitle || "这本书"}》，才明白真正重要的是什么`;
  const topic = bookTitle ? `《${bookTitle.replace(/[《》]/g, "")}》` : "这本书";
  const texts = [
    `为什么人人都认同的生活方式，反而可能让你忽略真正重要的事？${topic}给出了答案`,
    `真正活得明白的人，不会告诉你的一个忠告：先分清什么才值得在意`,
    `看完${topic}，你对这件事的理解会不再相同`,
    `很多问题反复出现的最根本原因，不是不努力，而是没有看清关键`,
    `给正处在人生低谷的人一个忠告：别急着证明，先把自己活明白`,
    `给总被现实困住的人一句话：改变往往从重新理解问题开始`,
    `从反复内耗到看清方向，我学到的最重要一课`,
    `停止盲目消耗，开始把力气用在真正重要的地方`,
    `如果你没方向、没答案、也不确定下一步，如何重新找回自己的节奏？`,
    source,
  ];
  const ids = [1, 7, 12, 14, 23, 23, 42, 54, 56, 12];
  return texts.map((text, index) => {
    const formula = FORMULAS.find((item) => item.id === ids[index])!;
    return {
      id: `fallback-long-${index + 1}`,
      text: cleanTitle(text, 86),
      formulaId: formula.id,
      trigger: formula.trigger,
      formulaTemplate: formula.template,
      originalExample: formula.example,
      reason: "保留抖音原标题的情绪力度与口语节奏，同时改用可追溯的 DBS 公式重建表达。",
    };
  });
}

function shortFallback(longTitle: string) {
  const pool = [
    "这句话值得收藏", "别再忽略关键", "真正重要的选择", "先把自己活明白", "重新理解人生",
    "答案藏在书里", "越早明白越好", "把生活排个序", "读完豁然开朗", "看清问题本质",
  ];
  const keyword = cleanTitle(longTitle, 12).replace(/[，。！？,.!?]/g, "");
  if (keyword.length >= 4 && keyword.length <= 12 && !pool.includes(keyword)) pool[9] = keyword;
  return pool.map((text, index) => ({ id: `fallback-short-${index + 1}`, text }));
}

function uniqueHashtags(values: unknown, bookTitle: string) {
  const source = Array.isArray(values) ? values : [];
  const pool = [...source, "#读书", "#好书推荐", "#人生感悟", "#认知成长", "#自我提升", "#文字的力量", bookTitle ? `#${bookTitle.replace(/[《》#＃\s]/g, "").slice(0, 12)}` : ""];
  const seen = new Set<string>();
  return pool.map((item) => {
    const clean = String(item || "").replace(/\s+/g, "").replace(/^[#＃]+/, "").replace(/[^\p{L}\p{N}_\u4e00-\u9fff]/gu, "").slice(0, 16);
    return clean ? `#${clean}` : "";
  }).filter((item) => item && !seen.has(item) && seen.add(item)).slice(0, 24);
}

function response(meta: Record<string, any>, extra: Record<string, any> = {}) {
  return {
    ok: true,
    longCandidates: meta.long_title_candidates || [],
    shortCandidates: meta.short_title_candidates || [],
    selectedLongTitle: meta.selected_long_title || "",
    selectedShortTitle: meta.selected_short_title || "",
    stage: meta.title_stage || "idle",
    provider: meta.title_provider || "",
    hashtags: meta.hashtags || [],
    ...extra,
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "generate_long");
  const meta = readMeta(id) as Record<string, any>;
  const artifacts = getArtifacts(id);
  const scriptText =
    artifacts.find((item) => item.stepName === "rewrite" && item.kind === "rewrite")?.content ||
    artifacts.find((item) => item.stepName === "transcribe" && item.kind === "cleaned")?.content ||
    "";
  const bookTitle = String(task.bookTitle || meta.book_title || "");
  const bookAuthor = String(task.bookAuthor || meta.book_author || "");
  const sourceTitle = String(task.title || "");
  const llm = getLLM();

  if (action === "select_long") {
    const title = cleanTitle(body.title, 86);
    const candidates = uniqueCandidates(meta.long_title_candidates, 10, 86);
    if (!candidates.some((item) => item.text === title)) {
      return NextResponse.json({ error: "所选长标题不在当前候选列表中，请重新选择" }, { status: 400 });
    }
    const next = {
      ...meta,
      selected_long_title: title,
      selected_short_title: "",
      short_title_candidates: [],
      short_titles: [],
      title_stage: "long_confirmed",
      title_long_confirmed_at: Date.now(),
    };
    writeMeta(id, next);
    return NextResponse.json(response(next));
  }

  if (action === "select_short") {
    if (!String(meta.selected_long_title || "").trim()) {
      return NextResponse.json({ error: "请先确认长标题" }, { status: 409 });
    }
    const title = cleanTitle(body.title, 16);
    const candidates = uniqueCandidates(meta.short_title_candidates, 10, 16);
    if (!candidates.some((item) => item.text === title)) {
      return NextResponse.json({ error: "所选短标题不在当前候选列表中，请重新选择" }, { status: 400 });
    }
    const next = {
      ...meta,
      selected_short_title: title,
      title_stage: "complete",
      title_short_confirmed_at: Date.now(),
      title_completed_at: Date.now(),
    };
    writeMeta(id, next);
    return NextResponse.json(response(next));
  }

  if (action === "generate_short") {
    const selectedLong = String(meta.selected_long_title || "").trim();
    if (!selectedLong) return NextResponse.json({ error: "请先确认一个长标题，再生成短标题" }, { status: 409 });
    try {
      const raw = await llm.chat({
        system: `你是视频号图书短视频的短标题编辑。只基于用户已经确认的长标题，生成 10 个不同的中文短标题。
要求：每条 4-12 个中文字符为主，最长不超过 16 个字符；保留长标题的核心冲突或情绪；适合封面大字；不添加书名号、话题、标点堆叠；不编造事实；输出严格 JSON：{"short_titles":[{"text":"..."}]}。必须恰好 10 条。`,
        user: `已确认长标题：${selectedLong}\n书名：${bookTitle || "未知"}\n请生成 10 个短标题。`,
        temperature: 0.8,
        json: true,
      });
      const generated = uniqueCandidates(parseJson(raw).short_titles, 10, 16);
      const candidates = uniqueCandidates([...generated, ...shortFallback(selectedLong)], 10, 16);
      const next = {
        ...meta,
        short_title_candidates: candidates,
        short_titles: candidates.map((item) => item.text),
        selected_short_title: "",
        title_stage: "short_pending",
        title_provider: llm.name,
        title_short_generated_at: Date.now(),
      };
      writeMeta(id, next);
      return NextResponse.json(response(next));
    } catch (error: any) {
      const candidates = shortFallback(selectedLong);
      const next = {
        ...meta,
        short_title_candidates: candidates,
        short_titles: candidates.map((item) => item.text),
        selected_short_title: "",
        title_stage: "short_pending",
        title_provider: `fallback:${llm.name}`,
        title_short_generated_at: Date.now(),
      };
      writeMeta(id, next);
      return NextResponse.json(response(next, { warning: `AI 短标题生成失败，已使用本地兜底：${String(error?.message || error).slice(0, 180)}` }));
    }
  }

  if (action !== "generate_long") return NextResponse.json({ error: "未知标题操作" }, { status: 400 });

  const sourceLength = cleanTitle(sourceTitle, 86).length;
  const minLength = Math.max(12, Math.floor(sourceLength * 0.8));
  const maxLength = Math.min(86, Math.max(28, Math.ceil(sourceLength * 1.2)));
  const formulaText = FORMULAS.map((item) => `#${item.id}｜${item.trigger}｜${item.template}｜原始爆款：${item.example}`).join("\n");
  try {
    const raw = await llm.chat({
      system: `你是 dbs-xhs-title 公式匹配器，负责为视频号图书短视频生成长标题，不是自由标题生成器。
必须从给定公式中选择 5-8 个最合适的公式，覆盖至少 3 类心理触发器；生成恰好 10 个标题，每个标题必须可追溯到公式编号，不得改变公式的底层逻辑。
标题要仿写抖音原标题的长度、口语节奏、情绪强度和标点方式，但不得照抄独特措辞或句序。优先制造好奇缺口、真实痛点和张力，不夸大疗效，不承诺暴富，不编造书中原句。
输出严格 JSON：{"long_titles":[{"text":"...","formula_id":12,"reason":"为什么这个公式适合本条内容"}],"hashtags":["#读书"]}。只输出 JSON。

可用公式：
${formulaText}`,
      user: `抖音原标题：${sourceTitle || "未提供"}
原标题字符数：${sourceLength || "未知"}
建议标题长度：${sourceLength ? `${minLength}-${maxLength} 字符，尽量贴近原长度` : "18-46 字符"}
书名：${bookTitle || "未知"}
作者：${bookAuthor || "未知"}
口播稿摘要：${scriptText.replace(/\s+/g, " ").slice(0, 2600)}

请先在内部完成公式匹配，再输出 10 个长标题方案。`,
      temperature: 0.9,
      json: true,
    });
    const json = parseJson(raw);
    const generated = uniqueCandidates(json.long_titles, 10, 86).filter((item) => item.formulaId);
    const candidates = uniqueCandidates([...generated, ...longFallback(sourceTitle, bookTitle)], 10, 86);
    const hashtags = uniqueHashtags(json.hashtags, bookTitle);
    const next = {
      ...meta,
      long_title_candidates: candidates,
      video_titles: candidates.map((item) => item.text),
      selected_long_title: "",
      short_title_candidates: [],
      short_titles: [],
      selected_short_title: "",
      hashtags,
      title_stage: "long_pending",
      title_provider: llm.name,
      title_generated_at: Date.now(),
      title_source_title: sourceTitle,
      title_source_length: sourceLength,
      title_skill: "dbs-xhs-title",
    };
    writeMeta(id, next);
    return NextResponse.json(response(next));
  } catch (error: any) {
    const candidates = longFallback(sourceTitle, bookTitle);
    const next = {
      ...meta,
      long_title_candidates: candidates,
      video_titles: candidates.map((item) => item.text),
      selected_long_title: "",
      short_title_candidates: [],
      short_titles: [],
      selected_short_title: "",
      hashtags: uniqueHashtags([], bookTitle),
      title_stage: "long_pending",
      title_provider: `fallback:${llm.name}`,
      title_generated_at: Date.now(),
      title_source_title: sourceTitle,
      title_source_length: sourceLength,
      title_skill: "dbs-xhs-title",
    };
    writeMeta(id, next);
    return NextResponse.json(response(next, { warning: `AI 长标题生成失败，已使用 DBS 公式兜底：${String(error?.message || error).slice(0, 180)}` }));
  }
}
