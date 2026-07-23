"use client";

import { useEffect, useMemo, useState } from "react";
import { copyTextToClipboard } from "./clipboard";

type Candidate = {
  id: string;
  text: string;
  formulaId?: number;
  trigger?: string;
  formulaTemplate?: string;
  originalExample?: string;
  reason?: string;
};

function asCandidates(value: unknown): Candidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (typeof item === "string") return { id: `legacy-${index + 1}`, text: item };
      const candidate = item as Record<string, unknown>;
      return {
        id: String(candidate.id || `candidate-${index + 1}`),
        text: String(candidate.text || ""),
        formulaId: Number(candidate.formulaId || 0) || undefined,
        trigger: String(candidate.trigger || ""),
        formulaTemplate: String(candidate.formulaTemplate || ""),
        originalExample: String(candidate.originalExample || ""),
        reason: String(candidate.reason || ""),
      };
    })
    .filter((item) => item.text);
}

export default function TitleSelectionPanel({ task, book, busy, reload }: any) {
  const savedLong = useMemo(() => asCandidates(book.long_title_candidates || book.video_titles), [book.long_title_candidates, book.video_titles]);
  const savedShort = useMemo(() => asCandidates(book.short_title_candidates || book.short_titles), [book.short_title_candidates, book.short_titles]);
  const [longCandidates, setLongCandidates] = useState<Candidate[]>(savedLong);
  const [shortCandidates, setShortCandidates] = useState<Candidate[]>(savedShort);
  const [selectedLong, setSelectedLong] = useState(String(book.selected_long_title || ""));
  const [selectedShort, setSelectedShort] = useState(String(book.selected_short_title || ""));
  const [stage, setStage] = useState(String(book.title_stage || (selectedShort ? "complete" : selectedLong ? "long_confirmed" : "idle")));
  const [working, setWorking] = useState("");
  const [warning, setWarning] = useState("");
  const [provider, setProvider] = useState(String(book.title_provider || ""));
  const [hashtags, setHashtags] = useState<string[]>(Array.isArray(book.hashtags) ? book.hashtags : []);

  useEffect(() => {
    setLongCandidates(savedLong);
    setShortCandidates(savedShort);
    setSelectedLong(String(book.selected_long_title || ""));
    setSelectedShort(String(book.selected_short_title || ""));
    setStage(String(book.title_stage || "idle"));
    setProvider(String(book.title_provider || ""));
    setHashtags(Array.isArray(book.hashtags) ? book.hashtags : []);
  }, [book.hashtags, book.selected_long_title, book.selected_short_title, book.title_provider, book.title_stage, savedLong, savedShort]);

  const request = async (action: string, title = "") => {
    if (working) return null;
    setWorking(action);
    setWarning("");
    try {
      const response = await fetch(`/api/tasks/${task.id}/titles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, title }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload.error || `${response.status} ${response.statusText}`));
      setLongCandidates(asCandidates(payload.longCandidates));
      setShortCandidates(asCandidates(payload.shortCandidates));
      setSelectedLong(String(payload.selectedLongTitle || ""));
      setSelectedShort(String(payload.selectedShortTitle || ""));
      setStage(String(payload.stage || "idle"));
      setProvider(String(payload.provider || ""));
      setHashtags(Array.isArray(payload.hashtags) ? payload.hashtags : []);
      setWarning(String(payload.warning || ""));
      await reload?.();
      return payload;
    } catch (error: any) {
      setWarning(String(error?.message || error));
      return null;
    } finally {
      setWorking("");
    }
  };

  const longConfirmed = Boolean(selectedLong);
  const complete = stage === "complete" && Boolean(selectedShort);
  const sourceTitle = String(task.title || "").trim();

  return (
    <div className="title-card-panel">
      <div className="title-panel-head">
        <div>
          <h3>视频号标题选择</h3>
          <p>严格按“10 个长标题 → 确认 1 个 → 10 个短标题 → 确认 1 个”执行。长标题使用 DBS 爆款公式，并参照抖音原标题的长度与节奏。</p>
        </div>
        <span className={`title-stage-badge ${complete ? "complete" : ""}`}>
          {complete ? "标题已完成" : longConfirmed ? "等待确认短标题" : "等待确认长标题"}
        </span>
      </div>

      <div className="title-source-box">
        <span>抖音原标题</span>
        <strong>{sourceTitle || "尚未获取原标题"}</strong>
        {sourceTitle && <em>{sourceTitle.length} 字符</em>}
      </div>

      <section className="title-choice-stage">
        <div className="title-stage-head">
          <div>
            <span>第一步</span>
            <h4>选择长标题 · 10 个方案</h4>
          </div>
          <button className="btn btn-ghost" disabled={busy || Boolean(working)} onClick={() => request("generate_long")}>
            {working === "generate_long" ? "正在匹配 DBS 公式..." : longCandidates.length ? "重新生成 10 个长标题" : "生成 10 个长标题"}
          </button>
        </div>
        {longCandidates.length ? (
          <div className="title-candidate-grid">
            {longCandidates.map((candidate, index) => {
              const selected = candidate.text === selectedLong;
              return (
                <article key={candidate.id || index} className={`title-candidate-card ${selected ? "selected" : ""}`}>
                  <button className="title-candidate-main" type="button" onClick={() => copyTextToClipboard(candidate.text)}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{candidate.text}</strong>
                  </button>
                  {candidate.formulaId && (
                    <div className="title-formula-meta">
                      <b>公式 #{candidate.formulaId} · {candidate.trigger}</b>
                      <span>{candidate.formulaTemplate}</span>
                      <small>原始爆款：{candidate.originalExample}</small>
                      <p>{candidate.reason}</p>
                    </div>
                  )}
                  <button
                    className={`btn ${selected ? "btn-ok" : "btn-ghost"}`}
                    disabled={busy || Boolean(working) || selected}
                    onClick={() => request("select_long", candidate.text)}
                  >
                    {selected ? "已确认此长标题" : "确认此长标题"}
                  </button>
                </article>
              );
            })}
          </div>
        ) : <div className="title-empty-state">点击上方按钮，系统会根据抖音原标题匹配 5–8 个 DBS 公式，并生成 10 个可追溯方案。</div>}
      </section>

      <section className={`title-choice-stage ${!longConfirmed ? "locked" : ""}`}>
        <div className="title-stage-head">
          <div>
            <span>第二步</span>
            <h4>基于已选长标题生成短标题 · 10 个方案</h4>
          </div>
          <button className="btn btn-ghost" disabled={busy || Boolean(working) || !longConfirmed} onClick={() => request("generate_short")}>
            {working === "generate_short" ? "正在压缩短标题..." : shortCandidates.length ? "重新生成 10 个短标题" : "生成 10 个短标题"}
          </button>
        </div>
        {longConfirmed && <div className="selected-title-summary"><span>已选长标题</span><strong>{selectedLong}</strong></div>}
        {!longConfirmed ? (
          <div className="title-empty-state">先确认一个长标题，短标题阶段才会解锁。</div>
        ) : shortCandidates.length ? (
          <div className="short-title-grid">
            {shortCandidates.map((candidate, index) => {
              const selected = candidate.text === selectedShort;
              return (
                <button
                  key={candidate.id || index}
                  className={`short-title-choice ${selected ? "selected" : ""}`}
                  disabled={busy || Boolean(working) || selected}
                  onClick={() => request("select_short", candidate.text)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{candidate.text}</strong>
                  <em>{selected ? "已确认" : "确认"}</em>
                </button>
              );
            })}
          </div>
        ) : <div className="title-empty-state">点击“生成 10 个短标题”，系统只会基于你已确认的长标题做精炼。</div>}
      </section>

      {provider && <p className="title-provider-line">生成来源：{provider}</p>}
      {warning && <div className="cover-error" role="alert">{warning}</div>}
      {hashtags.length > 0 && (
        <div className="hashtag-panel">
          <div className="hashtag-panel-head">
            <h4>话题标签 · 单独复制</h4>
            <button className="btn btn-ghost" onClick={() => copyTextToClipboard(hashtags.join(" "))}>复制全部话题</button>
          </div>
          <button className="hashtag-copy-box" onClick={() => copyTextToClipboard(hashtags.join(" "))}>{hashtags.join(" ")}</button>
        </div>
      )}
    </div>
  );
}
