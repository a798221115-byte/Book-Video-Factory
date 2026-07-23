import Link from "next/link";
import { getArtifacts, listTasks } from "@/lib/pipeline/repo";

export const dynamic = "force-dynamic";

type TaskRow = ReturnType<typeof listTasks>[number];

type BookGroup = {
  key: string;
  label: string;
  author: string;
  count: number;
  done: number;
  running: number;
  failed: number;
  videos: number;
  latestAt: number;
  sampleTaskId: string;
};

function normalizeBook(value: unknown) {
  return String(value || "").replace(/[《》\s,，。:：]/g, "").trim();
}

function displayBook(value: unknown) {
  return String(value || "").replace(/[《》]/g, "").trim() || "未识别书名";
}

function formatTime(value: number) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildGroups(tasks: TaskRow[]) {
  const groups = new Map<string, BookGroup>();
  for (const task of tasks) {
    const rawTitle = task.bookTitle || "";
    const key = normalizeBook(rawTitle) || "__unknown";
    const existing = groups.get(key);
    const videos = getArtifacts(task.id).filter((artifact) => artifact.stepName === "render" && artifact.kind === "video").length;
    const status = task.status || "idle";
    if (existing) {
      existing.count += 1;
      existing.done += status === "done" ? 1 : 0;
      existing.running += status === "running" ? 1 : 0;
      existing.failed += status === "failed" ? 1 : 0;
      existing.videos += videos;
      existing.latestAt = Math.max(existing.latestAt, task.updatedAt || task.createdAt || 0);
      if (!existing.author && task.bookAuthor) existing.author = task.bookAuthor;
      continue;
    }
    groups.set(key, {
      key,
      label: key === "__unknown" ? "未识别书名" : displayBook(rawTitle),
      author: String(task.bookAuthor || "").trim(),
      count: 1,
      done: status === "done" ? 1 : 0,
      running: status === "running" ? 1 : 0,
      failed: status === "failed" ? 1 : 0,
      videos,
      latestAt: task.updatedAt || task.createdAt || 0,
      sampleTaskId: task.id,
    });
  }
  return Array.from(groups.values()).sort((a, b) => b.latestAt - a.latestAt || b.count - a.count);
}

export default async function BooksPage() {
  const tasks = listTasks();
  const books = buildGroups(tasks);
  const totalTasks = tasks.length;
  const running = tasks.filter((task) => task.status === "running").length;
  const totalVideos = books.reduce((sum, book) => sum + book.videos, 0);

  return (
    <main className="collector-page books-page">
      <header className="collector-header">
        <div>
          <div className="eyebrow">BOOK LIBRARY</div>
          <h1>书籍库</h1>
        </div>
        <div className="header-actions">
          <Link className="soft-pill" href="/">返回采集台</Link>
          <span className="soft-pill success">{books.length} 本书</span>
        </div>
      </header>

      <section className="books-summary">
        <div className="metric-card">
          <span>书籍数</span>
          <strong>{books.length}</strong>
        </div>
        <div className="metric-card">
          <span>任务总数</span>
          <strong>{totalTasks}</strong>
        </div>
        <div className="metric-card">
          <span>运行中</span>
          <strong>{running}</strong>
        </div>
        <div className="metric-card">
          <span>视频产物</span>
          <strong>{totalVideos}</strong>
        </div>
      </section>

      <section className="dashboard-panel books-panel" aria-label="书籍列表">
        <div className="results-head">
          <div>
            <h2>按书籍聚合</h2>
            <p>从现有采集任务自动归并，点击筛选可回到主页只看这本书。</p>
          </div>
        </div>

        <div className="book-grid">
          {books.length === 0 && <div className="book-empty">暂无任务。</div>}
          {books.map((book) => (
            <article className="book-card" key={book.key}>
              <div>
                <span>{book.author || "作者待确认"}</span>
                <h2>{book.label}</h2>
              </div>
              <div className="book-card-stats">
                <strong>{book.count} 个任务</strong>
                <span>{book.done} 完成</span>
                <span>{book.running} 运行</span>
                <span>{book.failed} 异常</span>
                <span>{book.videos} 视频</span>
              </div>
              <p>最近更新：{formatTime(book.latestAt)}</p>
              <div className="book-card-actions">
                <Link className="btn btn-primary" href={book.key === "__unknown" ? "/?book=__unknown" : `/?book=${encodeURIComponent(book.label)}`}>筛选任务</Link>
                <Link className="btn btn-ghost" href={`/tasks/${book.sampleTaskId}`}>打开最近任务</Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
