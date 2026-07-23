import { listTasks } from "@/lib/pipeline/repo";
import Link from "next/link";
import NewTaskForm from "@/components/NewTaskForm";
import CollectorTable from "@/components/CollectorTable";
import IntakeHome from "@/components/intake/IntakeHome";

export const dynamic = "force-dynamic";

type TaskRow = ReturnType<typeof listTasks>[number];

function parseStats(raw: string | null) {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, number>; }
  catch { return {}; }
}

function qv(params: Record<string, string | string[] | undefined>, key: string) {
  const v = params[key];
  return Array.isArray(v) ? v[0] || "" : v || "";
}

function numberParam(params: Record<string, string | string[] | undefined>, key: string) {
  const raw = qv(params, key).trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function normalizeBook(value: unknown) {
  return String(value || "").replace(/[《》\s,，。:：]/g, "").trim();
}

function buildBookOptions(tasks: TaskRow[]) {
  const counts = new Map<string, { label: string; count: number }>();
  let unknownCount = 0;
  for (const t of tasks) {
    const title = String(t.bookTitle || "").trim();
    if (!title) {
      unknownCount += 1;
      continue;
    }
    const key = normalizeBook(title);
    if (!key) {
      unknownCount += 1;
      continue;
    }
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { label: title.replace(/[《》]/g, "").trim(), count: 1 });
  }
  return {
    books: Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN")),
    unknownCount,
  };
}

function filterTasks(tasks: TaskRow[], params: Record<string, string | string[] | undefined>) {
  const selectedBook = qv(params, "book");
  const selectedBookKey = normalizeBook(selectedBook);
  const bookQuery = qv(params, "bookQuery").trim().toLowerCase();
  const followersMin = numberParam(params, "followersMin");
  const followersMax = numberParam(params, "followersMax");
  const commentsMin = numberParam(params, "commentsMin");
  const commentsMax = numberParam(params, "commentsMax");
  const sharesMin = numberParam(params, "sharesMin");
  const sharesMax = numberParam(params, "sharesMax");
  const publishedRange = qv(params, "publishedRange");
  const sortField = qv(params, "sortField") || "createdAt";
  const sortDir = qv(params, "sortDir") || "desc";
  const now = Date.now();

  const filtered = tasks.filter((t) => {
    const bookTitle = String(t.bookTitle || "").trim();
    const bookAuthor = String(t.bookAuthor || "").trim();
    if (selectedBook === "__unknown" && bookTitle) return false;
    if (selectedBookKey && selectedBook !== "__unknown" && normalizeBook(bookTitle) !== selectedBookKey) return false;
    if (bookQuery) {
      const haystack = `${bookTitle} ${bookAuthor} ${t.title || ""}`.toLowerCase();
      if (!haystack.includes(bookQuery)) return false;
    }
    const s = parseStats(t.stats);
    const followers = Number(s.followers || 0);
    const comments = Number(s.comments || 0);
    const shares = Number(s.shares || 0);
    const publishedAt = Number(s.publishedAt || t.updatedAt);
    if (followersMin !== null && followers < followersMin) return false;
    if (followersMax !== null && followers > followersMax) return false;
    if (commentsMin !== null && comments < commentsMin) return false;
    if (commentsMax !== null && comments > commentsMax) return false;
    if (sharesMin !== null && shares < sharesMin) return false;
    if (sharesMax !== null && shares > sharesMax) return false;
    if (publishedRange === "7" && now - publishedAt > 7 * 86400_000) return false;
    if (publishedRange === "30" && now - publishedAt > 30 * 86400_000) return false;
    return true;
  });

  const score = (t: TaskRow) => {
    const s = parseStats(t.stats);
    if (sortField === "likes") return Number(s.likes || 0);
    if (sortField === "comments") return Number(s.comments || 0);
    if (sortField === "shares") return Number(s.shares || 0);
    if (sortField === "followers") return Number(s.followers || 0);
    return t.createdAt;
  };
  return filtered.sort((a, b) => sortDir === "asc" ? score(a) - score(b) : score(b) - score(a));
}

function demoTasks() {
  const now = Date.now();
  return [
    {
      id: "demo",
      sourceUrl: "https://v.douyin.com/demo-book-video",
      title: "一个人真正的强大，是允许一切发生",
      author: "每天读点书",
      bookTitle: null,
      bookAuthor: null,
      projectPath: null,
      currentGate: "BOOK_CONFIRMATION",
      status: "waiting_confirmation",
      stats: JSON.stringify({ likes: 54125, comments: 617, shares: 1869, duration: 68 }),
      notes: null,
      keyword: null,
      createdAt: now - 42 * 60_000,
      updatedAt: now - 5 * 60_000,
    },
    {
      id: "demo-ready",
      sourceUrl: "https://v.douyin.com/demo-weread",
      title: "越是低谷，越要懂得停止内耗",
      author: "夜读书房",
      bookTitle: "允许一切发生",
      bookAuthor: "杨万里",
      projectPath: null,
      currentGate: "WEREAD_HIGHLIGHTS",
      status: "ready_for_weread",
      stats: JSON.stringify({ likes: 29176, comments: 286, shares: 1153, duration: 54 }),
      notes: null,
      keyword: null,
      createdAt: now - 5 * 3600_000,
      updatedAt: now - 4 * 3600_000,
    },
    {
      id: "demo-running",
      sourceUrl: "https://v.douyin.com/demo-running",
      title: "人生下半场，拼的不是能力而是心态",
      author: "书香人生",
      bookTitle: null,
      bookAuthor: null,
      projectPath: null,
      currentGate: "INTAKE",
      status: "running",
      stats: JSON.stringify({ likes: 8423, comments: 91, shares: 624, duration: 61 }),
      notes: null,
      keyword: null,
      createdAt: now - 26 * 60_000,
      updatedAt: now - 2 * 60_000,
    },
    {
      id: "demo-failed",
      sourceUrl: "https://v.douyin.com/demo-failed",
      title: "真正困住你的，从来不是年龄",
      author: "好书共读",
      bookTitle: null,
      bookAuthor: null,
      projectPath: null,
      currentGate: "INTAKE",
      status: "failed",
      stats: JSON.stringify({ likes: 6201, comments: 77, shares: 408, duration: 47 }),
      notes: null,
      keyword: null,
      createdAt: now - 8 * 3600_000,
      updatedAt: now - 7 * 3600_000,
    },
  ];
}

export default async function Home({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const tasks = listTasks();
  const withDemo = params.demo === "1" && tasks.length === 0 ? demoTasks() : tasks;
  return <IntakeHome tasks={withDemo} />;
}

async function LegacyHome({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const allTasks = listTasks();
  const bookOptions = buildBookOptions(allTasks);
  const tasks = filterTasks(allTasks, params);
  const done = tasks.filter((t) => t.status === "done").length;
  const running = tasks.filter((t) => t.status === "running").length;

  return (
    <main className="collector-page">
      <header className="collector-header">
        <div>
          <div className="eyebrow">图书工作台</div>
          <h1>热点采集到混剪成片</h1>
        </div>
        <div className="header-actions">
          <Link className="soft-pill" href="/books">书籍库</Link>
          <Link className="soft-pill" href="/">刷新数据</Link>
          <span className="soft-pill success">备注随任务保存</span>
        </div>
      </header>

      <section className="dashboard-panel import-panel" aria-label="URL 导入">
        <div className="panel-title">URL 导入</div>
        <NewTaskForm />
      </section>

      <section className="dashboard-panel results-panel" aria-label="采集结果">
        <div className="results-head">
          <div>
            <h2>采集结果</h2>
            <p>第一版只做数据展示和人工筛选，可选创建任务后自动生成逐字稿</p>
          </div>
        </div>

        <form className="filter-bar" aria-label="筛选条件">
          <label>
            <span>书籍</span>
            <select name="book" defaultValue={qv(params, "book")} className="field dashboard-select">
              <option value="">全部书籍</option>
              {bookOptions.books.map((book) => (
                <option key={book.label} value={book.label}>{book.label}（{book.count}）</option>
              ))}
              {bookOptions.unknownCount > 0 && <option value="__unknown">未识别书名（{bookOptions.unknownCount}）</option>}
            </select>
          </label>
          <label>
            <span>书名/作者搜索</span>
            <input name="bookQuery" defaultValue={qv(params, "bookQuery")} className="field dashboard-input" placeholder="输入书名或作者" />
          </label>
          <label><span>粉丝数</span><input name="followersMin" defaultValue={qv(params, "followersMin")} className="field dashboard-input" placeholder="最小值" /></label>
          <label><span>&nbsp;</span><input name="followersMax" defaultValue={qv(params, "followersMax")} className="field dashboard-input" placeholder="最大值" /></label>
          <label><span>评论量</span><input name="commentsMin" defaultValue={qv(params, "commentsMin")} className="field dashboard-input" placeholder="最小值" /></label>
          <label><span>&nbsp;</span><input name="commentsMax" defaultValue={qv(params, "commentsMax")} className="field dashboard-input" placeholder="最大值" /></label>
          <label><span>分享量</span><input name="sharesMin" defaultValue={qv(params, "sharesMin")} className="field dashboard-input" placeholder="最小值" /></label>
          <label><span>&nbsp;</span><input name="sharesMax" defaultValue={qv(params, "sharesMax")} className="field dashboard-input" placeholder="最大值" /></label>
          <label><span>发布时间范围</span><select name="publishedRange" defaultValue={qv(params, "publishedRange") || "all"} className="field dashboard-select"><option value="all">不限</option><option value="7">近 7 天</option><option value="30">近 30 天</option></select></label>
          <label><span>排序字段</span><select name="sortField" defaultValue={qv(params, "sortField") || "createdAt"} className="field dashboard-select"><option value="createdAt">采集时间</option><option value="likes">点赞量</option><option value="comments">评论量</option><option value="shares">分享量</option><option value="followers">粉丝数</option></select></label>
          <label><span>排序方向</span><select name="sortDir" defaultValue={qv(params, "sortDir") || "desc"} className="field dashboard-select"><option value="desc">从高到低 / 从新到旧</option><option value="asc">从低到高 / 从旧到新</option></select></label>
          <div className="filter-actions">
            <button className="btn btn-primary" type="submit">应用筛选</button>
            <Link className="btn btn-ghost" href="/">重置</Link>
          </div>
        </form>

        <CollectorTable tasks={tasks} />

        <div className="result-summary">
          <span>共 {tasks.length} 条记录</span>
          <span>{running} 条运行中</span>
          <span>{done} 条已完成</span>
        </div>
      </section>
    </main>
  );
}
