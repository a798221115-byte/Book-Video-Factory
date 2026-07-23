"use client";

import { useEffect, useState } from "react";
import { fileUrl, parseJson, summarizeStepError } from "./shared";

export default function VideoCoverWorkspace({ taskId, task, book, videoCover, rewriteText, busy, setBusy, load }: any) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [status, setStatus] = useState("");
  const meta = parseJson(videoCover?.meta);
  const canGenerate = !!rewriteText || !!task?.bookTitle || !!book?.book_title;

  const generate = async () => {
    if (!canGenerate) {
      setStatus("需要先有书籍信息或改写稿。");
      return;
    }
    setBusy(true);
    setStatus("正在生成视频首页图...");
    try {
      const res = await fetch(`/api/tasks/${taskId}/video-cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task?.bookTitle || book?.book_title || task?.title || "",
          author: task?.bookAuthor || book?.book_author || task?.author || "",
          hook: rewriteText,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `${res.status} ${res.statusText}`);
      setStatus(`已生成 · ${payload.provider || "image"}`);
      await load();
    } catch (error: any) {
      setStatus(`生成失败：${summarizeStepError(error?.message || error)}`);
    } finally {
      setTimeout(() => setBusy(false), 500);
    }
  };

  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewOpen]);

  return (
    <section className="video-cover-workspace">
      <div className="video-cover-head">
        <div>
          <div className="section-kicker">FIRST FRAME</div>
          <h2>视频首页图</h2>
          <p>单独生成 9:16 第一屏图，和书籍封面、正文场景图分开管理。</p>
        </div>
        <button className="btn btn-ok" disabled={busy || !canGenerate} onClick={generate}>
          {videoCover?.path ? "重新生成首页图" : "生成首页图"}
        </button>
      </div>

      <div className="video-cover-body">
        {videoCover?.path ? (
          <button className="video-cover-preview" type="button" onClick={() => setPreviewOpen(true)}>
            <img src={fileUrl(videoCover.path)} alt="视频首页图" />
          </button>
        ) : (
          <div className="video-cover-empty">暂无视频首页图。</div>
        )}
        <div className="video-cover-copy">
          <strong>{videoCover?.path ? "首页图已就绪" : "生成策略"}</strong>
          <span>{status || (videoCover?.path ? `${meta.provider || "image"} · ${meta.size || "9:16"}` : "会用书名、作者和改写稿开头生成，不要求模型写中文字。")}</span>
          <p>成片时会优先把这张图放进图片时间轴第一位，用作视频第一屏。</p>
        </div>
      </div>

      {previewOpen && videoCover?.path && (
        <div className="candidate-lightbox" role="dialog" aria-modal="true" aria-label="视频首页图预览" onClick={() => setPreviewOpen(false)}>
          <div className="candidate-lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <div className="candidate-lightbox-head">
              <strong>视频首页图</strong>
              <button type="button" className="btn btn-ghost" onClick={() => setPreviewOpen(false)}>关闭</button>
            </div>
            <div className="candidate-lightbox-stage">
              <img src={fileUrl(videoCover.path)} alt="视频首页图大图预览" />
            </div>
            <div className="candidate-lightbox-meta">
              <span>{meta.size || "9:16"}</span>
              <p>{meta.hook || "视频第一屏"}</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
