"use client";

import { Metric } from "./shared";

export default function RewriteWorkspace({ task, book, config, setConfig, busy, canRun, act, saveTaskConfig }: any) {
  const notes = config.notes || "";
  const noteCount = notes.trim().length;
  const currentBook = task.bookTitle || book.book_title || "未识别书名";
  const currentAuthor = task.bookAuthor || book.book_author || "未识别作者";

  const saveRewriteConfig = async () => {
    return await saveTaskConfig("rewrite", {
      notes,
      rewriteNotes: notes,
    }, "保存改写要求");
  };

  const runRewrite = async () => {
    if (!(await saveRewriteConfig())) return;
    await act("rerun", "rewrite");
  };

  return (
    <section className="rewrite-workspace">
      <div className="rewrite-head">
        <div>
          <div className="section-kicker">REWRITE</div>
          <h2>口播文案改写</h2>
        </div>
        <button className="btn btn-ok" disabled={busy || !canRun} onClick={runRewrite}>
          重新生成候选稿
        </button>
      </div>

      <div className="rewrite-summary">
        <Metric label="当前书名" value={currentBook} />
        <Metric label="当前作者" value={currentAuthor} />
        <Metric label="补充要求" value={noteCount ? `${noteCount} 字` : "未填写"} />
        <Metric label="输出目标" value="只改正文主体" />
      </div>

      <div className="rewrite-panel">
        <div className="rewrite-copy">
          <p>限定这一条任务的语气、避雷词和保留重点，适合需要控制口播风格时使用。</p>
          <label>
            <span>补充要求</span>
            <textarea
              className="field rewrite-area"
              value={notes}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, notes: e.target.value }))}
              placeholder="例如：更口语化一些、保留开头钩子、弱化医疗术语、适合视频号口播。"
            />
          </label>
          <small>留空时使用默认改写口径。</small>
        </div>
        <div className="rewrite-preview">
          <strong>改写提示</strong>
          <p>
            {notes.trim()
              ? notes.trim()
              : "默认按附件B执行：保留事实与核心观点，去掉自我介绍、栏目名和导流痕迹，输出纯正文。"}
          </p>
          <button className="btn btn-ghost" disabled={busy} onClick={saveRewriteConfig}>保存改写要求</button>
        </div>
      </div>
    </section>
  );
}
