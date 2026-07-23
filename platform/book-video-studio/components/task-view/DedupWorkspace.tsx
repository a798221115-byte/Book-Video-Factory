"use client";

import { useState } from "react";
import { parseJson } from "./shared";
import { copyTextToClipboard } from "./clipboard";

// 附件C 轻量去重微调（旁路工具，不进主流水线 STAGES）。
// 调 POST /api/tasks/[id]/dedup（DeepSeek），展示字数差异%、保留词、人工把关提示。
export default function DedupWorkspace({ taskId, hasCleaned, dedupArt, book, busy, setBusy, load }: any) {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const meta = parseJson(dedupArt?.meta);
  const content = result?.content || dedupArt?.content || "";
  const diffPct = result?.diffPct ?? meta.diff_pct;
  const protectedTerms = result?.protectedTerms ?? meta.protected_terms ?? [book.book_title, book.book_author].filter(Boolean).join("、");

  const runDedup = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/tasks/${taskId}/dedup`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setResult(j);
        await load();
      } else {
        setError(j.error || `${r.status} ${r.statusText}`);
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setTimeout(() => setBusy(false), 300);
    }
  };

  const adoptDedup = async () => {
    if (!content) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/tasks/${taskId}/dedup/adopt`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setResult((prev: any) => ({ ...(prev || {}), adoptedAt: j.adoptedAt, invalidatedDownstream: j.invalidatedDownstream }));
        await load();
      } else {
        setError(j.error || `${r.status} ${r.statusText}`);
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setTimeout(() => setBusy(false), 300);
    }
  };

  const copyText = () => { if (content) copyTextToClipboard(content); };

  return (
    <section className="work-section dedup-workspace">
      <div className="section-head">
        <div>
          <div className="section-kicker">DEDUP / 轻量去重微调</div>
          <h2>爆款文案二次发布</h2>
        </div>
        <button className="btn btn-ok" disabled={busy || !hasCleaned} onClick={runDedup}>
          {dedupArt ? "重新生成去重稿" : "生成去重稿"}
        </button>
      </div>

      <p className="dedup-hint">
        把同一篇爆款文案再发一遍（同号或矩阵号）时，做轻量微调避免被判搬运。基于已清洗正文做克制改写，字数差异目标 8% 以内。
        去重成功率不到 100%，同一文案在同账号上两次发布建议间隔 3-5 天。
      </p>

      {!hasCleaned && <div className="dedup-empty">需要先完成逐字稿清洗，才能生成去重稿。</div>}
      {error && <div className="dedup-error">去重失败：{error}</div>}

      {content && (
        <div className="dedup-result">
          <div className="dedup-meta">
            {typeof diffPct === "number" && (
              <span className={`dedup-badge ${diffPct <= 8 ? "ok" : "warn"}`}>
                字数差异 {diffPct}%{diffPct <= 8 ? "（达标）" : "（偏大，建议重生成）"}
              </span>
            )}
            {protectedTerms && <span className="dedup-protected">保留词：{protectedTerms}</span>}
            <button className="btn btn-ghost" disabled={!content} onClick={copyText}>复制去重稿</button>
            <button className="btn btn-ok" disabled={busy || !content} onClick={adoptDedup}>采用为口播稿</button>
          </div>
          {result?.adoptedAt && (
            <div className="dedup-empty">已采用去重稿。音频、场景图、字幕和成片已标记为待重新生成。</div>
          )}
          <div className="text-scroll dedup-text">{content}</div>
        </div>
      )}
    </section>
  );
}
