const BRIEF_MAX_CHARS = 25;
const BRIEF_MIN_CHARS = 6;
const DUPLICATE_SIMILARITY = 0.82;

const FALLBACK_LIGHTS = [
  "上午窗光", "午后柔光", "明亮日光", "窗边自然光", "晴天清光",
  "浅木色光影", "暖白日光", "通透白光", "淡绿色光影", "米白色柔光",
];

const LIGHTING_PREFIXES = [
  ...FALLBACK_LIGHTS,
  "晨光", "傍晚暖光", "雨后清光", "薄雾天光", "暖白灯光", "柔和灰蓝光", "低饱和绿意",
];

const DEFAULT_FALLBACK_MOTIFS = [
  "翻开书页与茶杯",
  "整理书桌的手",
  "安静阅读的背影",
  "厨房清淡早餐",
  "阳台绿植和水杯",
  "公园小路侧影",
  "餐桌旁笔记本",
  "书架前停顿",
  "窗前深呼吸的侧影",
  "木桌便签和铅笔",
  "客厅暖光阅读角",
  "玄关换鞋的日常",
  "雨后街角散步",
  "清晨铺好的床",
  "厨房洗净的水果",
  "长桌边的空椅",
  "玻璃杯里的清水",
  "手心里的便签",
  "窗帘边的柔光",
  "步道上的慢跑背影",
  "桌面上的日历",
  "咖啡旁的记录本",
  "沙发边的落地灯",
  "楼梯转角的光线",
  "整齐书架一角",
  "花瓶旁的翻页瞬间",
  "安静收纳的抽屉",
  "门口透进的晨光",
  "林荫下的独行背影",
  "木地板上的光斑",
];

const UNSAFE_OR_DARK_BRIEF_PATTERN = /病床|医院|病房|诊所|手术|注射|监护|检查仪器|伤口|器官|肿瘤|癌|昏暗|阴暗|黑暗|暗房|夜晚|深夜|冷光|破败|落寞|绝望|压抑|恐惧|痛苦|孤独|阴天|暴雨|废墟|水泥地/;

const BACKSTOP_OBJECTS = [
  "白瓷杯", "木质书签", "亚麻餐巾", "空白便签", "透明水杯", "灰蓝笔记本",
  "浅色铅笔", "小号台灯", "玻璃花瓶", "棉质靠枕", "木托盘", "素色日历",
];

const BACKSTOP_SETTINGS = [
  "浅木桌面", "窗边托盘", "整齐书架", "绿植旁边", "暖色台灯下", "灰蓝布面",
  "玄关木柜", "客厅边几", "阳台角落", "餐桌一角", "书房窗台", "白墙前景",
];

const TOPIC_FALLBACK_MOTIFS: { pattern: RegExp; motifs: string[] }[] = [
  {
    pattern: /健康|身体|睡眠|饮食|衰老|疾病|癌|糖尿|血糖|肾|尿酸|疼痛|药|手术|肌肉|运动|营养/,
    motifs: ["厨房窗边的清淡早餐", "运动鞋旁的水杯", "阳台绿植旁伸展", "清晨步道慢走背影"],
  },
  {
    pattern: /家庭|父母|孩子|婚姻|伴侣|关系|朋友|亲密|沟通|母亲|父亲/,
    motifs: ["餐桌上两只水杯", "客厅沙发旁的暖灯", "门口并排的鞋", "厨房里递水的手"],
  },
  {
    pattern: /工作|职场|公司|同事|老板|创业|会议|简历|办公室/,
    motifs: ["办公室窗边整理资料", "会议桌旁的空椅", "电脑旁的手写便签", "工位上的清晨光线"],
  },
  {
    pattern: /钱|财富|资产|消费|投资|收入|债务|账单|房子/,
    motifs: ["木桌上的账本和咖啡", "收纳盒里的票据", "窗边计算器和便签", "整齐摆放的硬币"],
  },
  {
    pattern: /人生|命运|选择|成长|认知|思考|习惯|读书|学习|改变|焦虑/,
    motifs: ["岔路口的安静背影", "书页旁的铅笔痕迹", "窗前沉思的侧影", "日历旁的空白便签"],
  },
  {
    pattern: /历史|时代|战争|政治|国家|权力/,
    motifs: ["书桌上的旧照片", "博物馆走廊的背影", "翻开的厚书和台灯", "窗光下的地图轮廓"],
  },
];

const FALLBACK_FRAMES: Array<(light: string, motif: string) => string> = [
  (light, motif) => `${light}里的${motif}`,
  (_light, motif) => `${motif}的安静近景`,
  (light, motif) => `${light}中${motif}`,
  (_light, motif) => `干净背景下的${motif}`,
  (_light, motif) => `${motif}与柔和光影`,
];

export function normalizeImageBrief(value: unknown): string {
  return String(value ?? "")
    .replace(/^\s*(?:\d+|[一二三四五六七八九十]+)[\.、\)\]）]\s*/, "")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, "")
    .replace(/[，,。.!！？?；;：:、]+$/g, "")
    .trim()
    .slice(0, BRIEF_MAX_CHARS);
}

function comparableBrief(value: unknown): string {
  return normalizeImageBrief(value)
    .toLowerCase()
    .replace(/[\s"'“”‘’《》<>【】\[\]（）(){}.,，。！？!?、；;：:·—_\-]/g, "");
}

function withoutLightingPrefix(value: unknown): string {
  let text = comparableBrief(value);
  for (const light of LIGHTING_PREFIXES.map((item) => comparableBrief(item)).sort((a, b) => b.length - a.length)) {
    for (const connector of ["里的", "中"]) {
      const prefix = `${light}${connector}`;
      if (text.startsWith(prefix)) text = text.slice(prefix.length);
    }
  }
  return text;
}

function charBigrams(value: string): Set<string> {
  const text = comparableBrief(value);
  if (text.length <= 1) return text ? new Set([text]) : new Set();
  const out = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) out.add(text.slice(i, i + 2));
  return out;
}

function briefSimilarity(a: string, b: string): number {
  const left = charBigrams(a);
  const right = charBigrams(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap++;
  }
  return overlap / (left.size + right.size - overlap);
}

function isDuplicateBrief(candidate: string, acceptedBriefs: string[]): boolean {
  const current = comparableBrief(candidate);
  const currentWithoutLight = withoutLightingPrefix(candidate);
  if (!current) return true;
  return acceptedBriefs.some((brief) => {
    const previous = comparableBrief(brief);
    if (!previous) return false;
    if (current === previous) return true;
    if (currentWithoutLight.length >= 6 && currentWithoutLight === withoutLightingPrefix(brief)) return true;
    if (Math.min(current.length, previous.length) >= 8 && (current.includes(previous) || previous.includes(current))) return true;
    return briefSimilarity(current, previous) >= DUPLICATE_SIMILARITY;
  });
}

function isDirectSourceReuse(candidate: string, sourceSegments: string[]): boolean {
  const current = comparableBrief(candidate);
  if (current.length < 10) return false;
  return sourceSegments.some((segment) => {
    const source = comparableBrief(segment);
    if (!source || source.length < current.length) return false;
    if (source.includes(current)) return true;
    const sourceHead = source.slice(0, Math.max(current.length, 18));
    return briefSimilarity(current, sourceHead) >= 0.88;
  });
}

export function isImageBriefUsable(candidate: unknown, sourceSegments: string[], acceptedBriefs: string[] = []): boolean {
  const brief = normalizeImageBrief(candidate);
  const compact = comparableBrief(brief);
  if (compact.length < BRIEF_MIN_CHARS) return false;
  if (UNSAFE_OR_DARK_BRIEF_PATTERN.test(brief)) return false;
  if (/^(?:生活|日常|场景|画面|镜头|意境|生活场景|留白意境镜头)\d*$/.test(compact)) return false;
  if (isDirectSourceReuse(brief, sourceSegments)) return false;
  if (isDuplicateBrief(brief, acceptedBriefs)) return false;
  return true;
}

export function selectQualityImageBriefs(
  sourceSegments: string[],
  candidates: unknown[],
  targetCount: number,
  seedBriefs: string[] = [],
): string[] {
  const accepted: string[] = [];
  for (const seed of seedBriefs) {
    const brief = normalizeImageBrief(seed);
    if (isImageBriefUsable(brief, sourceSegments, accepted)) accepted.push(brief);
    if (accepted.length >= targetCount) return accepted;
  }
  for (const candidate of candidates) {
    const brief = normalizeImageBrief(candidate);
    if (isImageBriefUsable(brief, sourceSegments, accepted)) accepted.push(brief);
    if (accepted.length >= targetCount) break;
  }
  return accepted;
}

export type ImageBriefExpansionRequest = {
  sourceSegments: string[];
  existingBriefs: string[];
  targetCount: number;
};

export type ImageBriefExpander = (request: ImageBriefExpansionRequest) => Promise<unknown[]>;

export async function expandImageBriefs(
  sourceSegments: string[],
  existingBriefs: string[],
  targetCount: number,
  expandCandidates?: ImageBriefExpander,
): Promise<string[]> {
  if (targetCount <= 0) return existingBriefs;
  const base = selectQualityImageBriefs(sourceSegments, existingBriefs, targetCount);
  if (base.length >= targetCount) return base;

  let merged = base;
  if (expandCandidates) {
    try {
      const candidates = await expandCandidates({ sourceSegments, existingBriefs: base, targetCount });
      if (Array.isArray(candidates)) {
        merged = selectQualityImageBriefs(sourceSegments, candidates, targetCount, base);
        if (merged.length >= targetCount) return merged;
      }
    } catch { /* fallback */ }
  }

  return buildFallbackImageBriefs(sourceSegments, merged, targetCount);
}

function uniqueMotifs(motifs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const motif of motifs) {
    const key = comparableBrief(motif);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(motif);
  }
  return out;
}

function fallbackMotifsForSources(sourceSegments: string[]): string[] {
  const source = sourceSegments.join("\n");
  const motifs: string[] = [];
  for (const topic of TOPIC_FALLBACK_MOTIFS) {
    if (topic.pattern.test(source)) motifs.push(...topic.motifs);
  }
  motifs.push(...DEFAULT_FALLBACK_MOTIFS);
  return uniqueMotifs(motifs);
}

export function buildFallbackImageBriefs(sourceSegments: string[], existingBriefs: string[], targetCount: number): string[] {
  const accepted = selectQualityImageBriefs(sourceSegments, existingBriefs, targetCount);
  if (accepted.length >= targetCount) return accepted.slice(0, targetCount);

  const motifs = fallbackMotifsForSources(sourceSegments);
  const maxAttempts = Math.max(600, targetCount * motifs.length * FALLBACK_FRAMES.length);
  for (let attempt = 0; accepted.length < targetCount && attempt < maxAttempts; attempt++) {
    const motif = motifs[attempt % motifs.length];
    const frame = FALLBACK_FRAMES[Math.floor(attempt / motifs.length) % FALLBACK_FRAMES.length];
    const light = FALLBACK_LIGHTS[Math.floor(attempt / (motifs.length * FALLBACK_FRAMES.length)) % FALLBACK_LIGHTS.length];
    const candidate = normalizeImageBrief(frame(light, motif));
    if (isImageBriefUsable(candidate, sourceSegments, accepted)) accepted.push(candidate);
  }

  const maxBackstopAttempts = targetCount * BACKSTOP_OBJECTS.length * BACKSTOP_SETTINGS.length * FALLBACK_LIGHTS.length;
  for (let attempt = 0; accepted.length < targetCount && attempt < maxBackstopAttempts; attempt++) {
    const object = BACKSTOP_OBJECTS[attempt % BACKSTOP_OBJECTS.length];
    const setting = BACKSTOP_SETTINGS[Math.floor(attempt / BACKSTOP_OBJECTS.length) % BACKSTOP_SETTINGS.length];
    const light = FALLBACK_LIGHTS[Math.floor(attempt / (BACKSTOP_OBJECTS.length * BACKSTOP_SETTINGS.length)) % FALLBACK_LIGHTS.length];
    const candidate = normalizeImageBrief(`${light}里的${object}和${setting}`);
    if (isImageBriefUsable(candidate, sourceSegments, accepted)) accepted.push(candidate);
  }

  if (accepted.length < targetCount) {
    throw new Error(`无法生成足量场景图 brief：需要 ${targetCount} 条，实际 ${accepted.length} 条`);
  }

  return accepted.slice(0, targetCount);
}
