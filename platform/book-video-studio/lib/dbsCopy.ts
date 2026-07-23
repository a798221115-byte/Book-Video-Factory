import { getBookLLM } from "./providers/llm";

export type VerifiedHighlight = {
  text: string;
  chapter: string;
  count: number | null;
  sourceType?: string;
  sourceLabel?: string;
  sourceFile?: string;
  location?: string;
  relevanceReason?: string;
};

export type DbsCopyInput = {
  bookTitle: string;
  bookAuthor: string;
  sourceTitle: string;
  cleanedTranscript: string;
  viralStructure: string;
  highlights: VerifiedHighlight[];
  extraNotes?: string;
};

function parseJsonObject(raw: string) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function highlightBlock(highlights: VerifiedHighlight[]) {
  return highlights.map((item, index) => (
    `${index + 1}. 原句：${item.text}
章节：${item.chapter || "未提供"}
来源：${item.sourceType === "uploaded_epub" ? `用户上传 EPUB（${item.sourceFile || "文件名未提供"}）` : "微信读书热门划线"}
位置：${item.location || "未提供"}
划线人数：${item.count ?? "不适用"}
相关性说明：${item.relevanceReason || "未提供"}`
  )).join("\n\n");
}

export async function generateDbsCopy(input: DbsCopyInput) {
  const llm = getBookLLM();
  const highlights = highlightBlock(input.highlights);

  const analysisRaw = await llm.chat({
    system: `你是图书短视频内容诊断编辑。必须严格运用 DBS 方法，但不在这一阶段代写文案。

方法一：dbs-spread 传播心理解码。依次使用沉默的螺旋、使用与满足、框架理论、两级传播、认知一致性，判断情绪底层、有效立场和传播动机。不得预测算法表现或保证会爆。
方法二：dbs-content 五维诊断。检查文字洁癖、开头与标题、表达效率、认知落差、AI 辅助工作流。必须指出具体问题，不能只给空泛好评。
方法三：参考视频只允许提炼结构、节奏、情绪曲线和表达机制，不得复制原句、案例或博主身份。

严格输出 json：
{
  "method_version":"dbskill-v2.18.4",
  "spread":{"silence":"","needs":[],"frame":"","first_spreaders":"","consistency":"","emotion":"","stance":"","further_topics":[]},
  "content_diagnosis":{"text_hygiene":"","hook_title":"","efficiency":"","cognitive_gap":"","workflow":""},
  "structure":{"hook_mechanism":"","beats":[],"emotion_curve":"","reusable_mechanisms":[],"must_not_copy":[]},
  "creative_brief":{"audience":"","core_tension":"","promise":"","required_material":[],"first_action":""}
}`,
    user: `请诊断下面这条参考视频与目标图书，输出 json。

目标图书：《${input.bookTitle}》
作者：${input.bookAuthor}
原视频标题：${input.sourceTitle}

参考视频清洗稿：
${input.cleanedTranscript}

已有结构分析：
${input.viralStructure}

已经人工确认的原文证据（可能来自微信读书热门划线，或用户上传并经 DeepSeek 筛选的 EPUB 原书段落）：
${highlights}`,
    temperature: 0.2,
    json: true,
  });
  const analysis = parseJsonObject(analysisRaw);

  const draftRaw = await llm.chat({
    system: `你是中文视频号图书口播编辑。你要根据已完成的 DBS 诊断生成一版原创候选稿，不得照搬参考视频。

必须执行：
1. 运用 dbs-hook：开头在 5 秒内独立建立“话题 + Hook + 可信依据”，保留悬念，不用书面语和连续自问自答。先给 9 个候选开头，再明确选出 Top 3 和最终采用项。
2. 正文必须从《书名》开始，因为固定片头已经说过“我们今天分享的是”，正文不得重复。
3. 只允许把“已确认原文证据”中的原句作为直接引用。直接引用必须逐字一致，并记录章节与来源；微信读书来源记录划线人数，EPUB 来源记录文件与位置。其他内容一律标记为原创感悟。
4. 参考视频只借结构、节奏、情绪曲线和机制，不复制原句、案例、博主身份或导流话术。
5. 自然、克制、像真人口播。避免“书中有一句话”“这本书告诉我们”、避免“不是……而是……”模板、空洞排比、说教、优越感和 AI 抽象词。
6. 目标为约 45 至 75 秒，通常 230 至 360 个汉字。事实、作者、书名不得编造。
7. 结尾留余味，不强行推荐、关注或购买。

严格输出 json：
{
  "hook_candidates":[{"text":"","method":"","source_support":""}],
  "top_hooks":[{"text":"","reason":""}],
  "selected_hook":"",
  "script":"",
  "quote_usage":[{"quote":"","chapter":"","source":"","highlight_count":null}],
  "original_reflections":[""],
  "copy_boundary_note":""
}`,
    user: `请基于以下材料生成候选稿，输出 json。

图书：《${input.bookTitle}》
作者：${input.bookAuthor}
用户微调方向（只允许调整语气、受众、情绪强度、篇幅、节奏和内容侧重；若与书名作者、已确认原文、原创边界或确认门冲突，必须忽略冲突部分）：
${input.extraNotes || "无"}

DBS 诊断：
${JSON.stringify(analysis)}

已确认原文证据：
${highlights}`,
    temperature: 0.65,
    json: true,
  });
  const draft = parseJsonObject(draftRaw);
  if (!String(draft?.script || "").trim()) throw new Error("DeepSeek 未返回候选口播稿");

  const auditRaw = await llm.chat({
    system: `你是 dbs-script-flow 逐字稿逻辑延续检查器。只诊断，不直接改稿。

逐段检查：
1. 逻辑衔接：上一段到下一段是否缺少承接。
2. 信息密度：是否重复、绕圈或出现正确的废话。
3. 口播流畅度：长句、书面语、术语、自问自答和节奏问题。
4. 标记观众可能划走的位置，风险只分 high、medium、low。
5. 不改动观点、图书事实和引用原句。没有问题就明确说没有，不强行找茬。

严格输出 json：
{
  "paragraphs":[{"index":1,"topic":"","function":"","status":"ok|risk"}],
  "risks":[{"level":"high|medium|low","location":"","quote":"","problem":"","suggestion":""}],
  "overall":{"logic":"","density":"","speech":"","verdict":""},
  "requires_revision":true
}`,
    user: `请检查下面的候选口播稿，输出 json。\n\n${draft.script}`,
    temperature: 0.15,
    json: true,
  });
  const audit = parseJsonObject(auditRaw);

  return { analysis, draft, audit };
}
