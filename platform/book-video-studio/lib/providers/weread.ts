const WEREAD_GATEWAY = "https://i.weread.qq.com/api/agent/gateway";
const WEREAD_SKILL_VERSION = "1.0.4";

type GatewayPayload = Record<string, unknown> & { api_name: string };

async function wereadRequest(payload: GatewayPayload) {
  const apiKey = process.env.WEREAD_API_KEY?.trim();
  if (!apiKey) throw new Error("未配置 WEREAD_API_KEY，无法查询微信读书");

  const response = await fetch(WEREAD_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, skill_version: WEREAD_SKILL_VERSION }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`微信读书接口 ${response.status}: ${String(data?.message || data?.errmsg || "请求失败")}`);
  }
  if (data?.upgrade_info) {
    throw new Error(String(data.upgrade_info.message || "weread-skills 需要升级后才能继续"));
  }
  if (Number(data?.errcode || 0) !== 0) {
    throw new Error(String(data?.errmsg || data?.message || `微信读书错误码 ${data.errcode}`));
  }
  return data;
}

function normalize(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[《》\s·•［］[\]()（）]/g, "")
    .toLowerCase();
}

function searchBooks(data: any) {
  const books: any[] = [];
  for (const group of Array.isArray(data?.results) ? data.results : []) {
    for (const item of Array.isArray(group?.books) ? group.books : []) {
      const info = item?.bookInfo || item;
      if (info?.bookId) books.push({ ...item, bookInfo: info });
    }
  }
  return books;
}

function selectVerifiedBook(books: any[], title: string, author: string) {
  const wantedTitle = normalize(title);
  const wantedAuthor = normalize(author);
  const ranked = books.map((item) => {
    const info = item.bookInfo || {};
    const foundTitle = normalize(info.title);
    const foundAuthor = normalize(info.author);
    let score = 0;
    if (foundTitle === wantedTitle) score += 100;
    else if (foundTitle.includes(wantedTitle) || wantedTitle.includes(foundTitle)) score += 45;
    if (wantedAuthor && foundAuthor === wantedAuthor) score += 60;
    else if (wantedAuthor && (foundAuthor.includes(wantedAuthor) || wantedAuthor.includes(foundAuthor))) score += 25;
    if (Number(info.soldout || 0) === 1) score -= 20;
    return { item, score };
  }).sort((a, b) => b.score - a.score);
  if (!ranked[0] || ranked[0].score < 100) {
    throw new Error(`微信读书未找到与《${title}》及作者“${author}”可靠匹配的版本`);
  }
  return ranked[0].item;
}

export type PopularHighlight = {
  id: string;
  text: string;
  chapter: string;
  count: number;
  chapterUid: number;
  range: string;
  rank?: number;
};

type PopularHighlightPageOptions = {
  offset?: number;
  limit?: number;
};

type HighlightCacheEntry = {
  expiresAt: number;
  book: any;
  popular: any;
  highlights: PopularHighlight[];
};

const HIGHLIGHT_CACHE_TTL_MS = 30 * 60 * 1000;
const baseHighlightCache = new Map<string, HighlightCacheEntry>();
const expandedHighlightCache = new Map<string, HighlightCacheEntry>();

function cacheKey(bookTitle: string, bookAuthor: string) {
  return `${normalize(bookTitle)}::${normalize(bookAuthor)}`;
}

function getFreshCache(cache: Map<string, HighlightCacheEntry>, key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function mapPopularHighlights(data: any, fallbackChapters: any[] = []): PopularHighlight[] {
  const chapters = [
    ...(Array.isArray(fallbackChapters) ? fallbackChapters : []),
    ...(Array.isArray(data?.chapters) ? data.chapters : []),
  ];
  const chapterMap = new Map(
    chapters.map((chapter: any) => [
      String(chapter.chapterUid),
      String(chapter.title || ""),
    ]),
  );
  return (Array.isArray(data?.items) ? data.items : [])
    .map((item: any) => ({
      id: String(item.bookmarkId || `${item.chapterUid}-${item.range}-${item.markText || ""}`),
      text: String(item.markText || "").trim(),
      chapter: chapterMap.get(String(item.chapterUid)) || "",
      count: Number(item.totalCount || 0),
      chapterUid: Number(item.chapterUid || 0),
      range: String(item.range || ""),
    }))
    .filter((item: PopularHighlight) => item.text);
}

export function mergeRankedHighlights(
  groups: PopularHighlight[][],
): PopularHighlight[] {
  const merged = new Map<string, PopularHighlight>();
  for (const item of groups.flat()) {
    const previous = merged.get(item.id);
    if (!previous || item.count > previous.count) {
      merged.set(item.id, {
        ...previous,
        ...item,
        chapter: item.chapter || previous?.chapter || "",
      });
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function paginateRankedHighlights(
  highlights: PopularHighlight[],
  offset = 0,
  limit = 10,
) {
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 10)));
  const page = highlights.slice(safeOffset, safeOffset + safeLimit);
  const nextOffset = safeOffset + page.length;
  return {
    highlights: page,
    offset: safeOffset,
    limit: safeLimit,
    nextOffset,
    hasMore: nextOffset < highlights.length,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, runWorker),
  );
  return results;
}

async function fetchBaseHighlights(bookTitle: string, bookAuthor: string) {
  const key = cacheKey(bookTitle, bookAuthor);
  const cached = getFreshCache(baseHighlightCache, key);
  if (cached) return cached;

  const search = await wereadRequest({
    api_name: "/store/search",
    keyword: bookTitle,
    scope: 10,
    count: 10,
  });
  const matched = selectVerifiedBook(searchBooks(search), bookTitle, bookAuthor);
  const book = matched.bookInfo;
  const popular = await wereadRequest({
    api_name: "/book/bestbookmarks",
    bookId: String(book.bookId),
    chapterUid: 0,
    synckey: 0,
  });
  const highlights = mergeRankedHighlights([mapPopularHighlights(popular)]);
  if (!highlights.length) throw new Error(`微信读书暂未返回《${bookTitle}》的热门划线`);

  const entry = {
    expiresAt: Date.now() + HIGHLIGHT_CACHE_TTL_MS,
    book: {
      bookId: String(book.bookId),
      title: String(book.title || ""),
      author: String(book.author || ""),
      cover: String(book.cover || ""),
      deepLink: String(book.deepLink || ""),
      publisher: String(book.publisher || ""),
    },
    popular,
    highlights,
  };
  baseHighlightCache.set(key, entry);
  return entry;
}

async function fetchExpandedHighlights(
  key: string,
  base: HighlightCacheEntry,
) {
  const cached = getFreshCache(expandedHighlightCache, key);
  if (cached) return cached;

  const chapterInfo = await wereadRequest({
    api_name: "/book/chapterinfo",
    bookId: String(base.book.bookId),
  });
  const chapters = (Array.isArray(chapterInfo?.chapters) ? chapterInfo.chapters : [])
    .filter((chapter: any) => Number(chapter.chapterUid || 0) > 0);
  const seenChapterUids = new Set<number>();
  const uniqueChapters = chapters.filter((chapter: any) => {
    const chapterUid = Number(chapter.chapterUid);
    if (seenChapterUids.has(chapterUid)) return false;
    seenChapterUids.add(chapterUid);
    return true;
  });

  const chapterGroups = await mapWithConcurrency(uniqueChapters, 4, async (chapter: any) => {
    try {
      const result = await wereadRequest({
        api_name: "/book/bestbookmarks",
        bookId: String(base.book.bookId),
        chapterUid: Number(chapter.chapterUid),
        synckey: 0,
      });
      return mapPopularHighlights(result, uniqueChapters);
    } catch {
      return [];
    }
  });
  const entry = {
    ...base,
    expiresAt: Date.now() + HIGHLIGHT_CACHE_TTL_MS,
    highlights: mergeRankedHighlights([base.highlights, ...chapterGroups]),
  };
  expandedHighlightCache.set(key, entry);
  return entry;
}

export async function fetchTopPopularHighlights(
  bookTitle: string,
  bookAuthor: string,
  options: PopularHighlightPageOptions = {},
) {
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
  const limit = Math.min(50, Math.max(1, Math.floor(Number(options.limit) || 10)));
  const key = cacheKey(bookTitle, bookAuthor);
  const base = await fetchBaseHighlights(bookTitle, bookAuthor);
  const requestedEnd = offset + limit;
  const source = requestedEnd > base.highlights.length
    ? await fetchExpandedHighlights(key, base)
    : base;
  const page = paginateRankedHighlights(source.highlights, offset, limit);
  const totalReported = Math.max(
    Number(base.popular?.totalCount || 0),
    source.highlights.length,
  );

  return {
    skillVersion: WEREAD_SKILL_VERSION,
    book: source.book,
    ...page,
    hasMore: source === base
      ? page.hasMore || page.nextOffset < totalReported
      : page.hasMore,
    totalAvailable: source.highlights.length,
    totalReported,
  };
}
