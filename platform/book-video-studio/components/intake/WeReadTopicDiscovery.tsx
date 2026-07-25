"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Candidate = {
  bookId: string;
  title: string;
  author: string;
  cover: string;
  deepLink: string;
  rating: number;
  readingCount: number;
  noteCount: number;
  popularHighlightCount: number;
  popularHighlightQuality: number;
  reason: string;
  sources: string[];
  score: number;
};

export default function WeReadTopicDiscovery() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/topics/weread?keyword=${encodeURIComponent(keyword.trim())}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "微信读书主动选题失败");
      setItems(payload.candidates || []);
    } catch (nextError: any) {
      setError(String(nextError?.message || nextError));
    } finally {
      setBusy(false);
    }
  }

  async function choose(book: Candidate) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/topics/weread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "创建主动选题任务失败");
      router.push(`/tasks/${payload.taskId}`);
    } catch (nextError: any) {
      setError(String(nextError?.message || nextError));
      setBusy(false);
    }
  }

  return (
    <section className="weread-topic-panel">
      <div className="weread-topic-heading">
        <div>
          <span>G00 主动选题</span>
          <h2>从微信读书发现下一条内容</h2>
          <p>综合个性推荐、你的书架/笔记和关键词搜索，按真实证据选出前 10 本。</p>
        </div>
        <div className="weread-topic-actions">
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="可选：输入主题或书名"
          />
          <button type="button" disabled={busy} onClick={refresh}>
            {busy ? "正在获取…" : items.length ? "更新候选" : "获取主动选题"}
          </button>
        </div>
      </div>
      {error ? <div className="weread-topic-error">{error}<small>不会使用模拟候选替代。</small></div> : null}
      {items.length ? (
        <div className="weread-topic-grid">
          {items.map((book, index) => (
            <article key={book.bookId} className="weread-topic-card">
              {book.cover ? <img src={book.cover} alt="" /> : <div className="weread-topic-cover">书</div>}
              <div>
                <small>#{index + 1} · {book.sources.join(" + ")}</small>
                <strong>{book.title}</strong>
                <span>{book.author || "作者待核验"}</span>
                <p>{book.reason || "综合微信读书阅读与划线证据推荐"}</p>
                <div className="weread-topic-metrics">
                  <span>评分 {book.rating || "—"}</span>
                  <span>在读 {book.readingCount || "—"}</span>
                  <span>笔记 {book.noteCount || "—"}</span>
                  <span>热门划线 {book.popularHighlightCount}</span>
                  <span>划线质量 {book.popularHighlightQuality}</span>
                </div>
                <button type="button" disabled={busy} onClick={() => choose(book)}>
                  确认这本书并创建任务
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
