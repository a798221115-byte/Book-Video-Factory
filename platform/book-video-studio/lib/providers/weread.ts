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

export async function fetchTopPopularHighlights(bookTitle: string, bookAuthor: string) {
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
  const chapterMap = new Map(
    (Array.isArray(popular?.chapters) ? popular.chapters : [])
      .map((chapter: any) => [String(chapter.chapterUid), String(chapter.title || "")]),
  );
  const highlights = (Array.isArray(popular?.items) ? popular.items : [])
    .map((item: any) => ({
      id: String(item.bookmarkId || `${item.chapterUid}-${item.range}`),
      text: String(item.markText || "").trim(),
      chapter: chapterMap.get(String(item.chapterUid)) || "",
      count: Number(item.totalCount || 0),
      chapterUid: Number(item.chapterUid || 0),
      range: String(item.range || ""),
    }))
    .filter((item: any) => item.text)
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 10);
  if (!highlights.length) throw new Error(`微信读书暂未返回《${bookTitle}》的热门划线`);

  return {
    skillVersion: WEREAD_SKILL_VERSION,
    book: {
      bookId: String(book.bookId),
      title: String(book.title || ""),
      author: String(book.author || ""),
      cover: String(book.cover || ""),
      deepLink: String(book.deepLink || ""),
      publisher: String(book.publisher || ""),
    },
    highlights,
  };
}
