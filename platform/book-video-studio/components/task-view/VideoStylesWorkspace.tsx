"use client";

import { MAX_RENDER_VIDEOS } from "./shared";

export default function VideoStylesWorkspace({ task, book, counts, setCounts, motions, setMotions, engine = "auto", setEngine, statement, setStatement, renderStep, renderCount, renderMissing = [], imageTarget = "auto", imageMode = "square", imageStyle = "photo", imageQuality = "high", busy, workflowRunning, canRender, act, saveTaskConfig }: any) {
  const styles = [
    { id: "clean", color: "#b54535", title: "清醒语录", desc: "强观点开头，适合观点型逐字稿。" },
    { id: "black", color: "#272727", title: "黑底打字机", desc: "文字节奏更强，适合金句和观点。" },
    { id: "card", color: "#9eb7c8", title: "暗色知识卡片", desc: "暗色底图，底部科普免责声明，适合知识类内容。" },
    { id: "book", color: "#d8c21d", title: "图书口播卡片", desc: "黑底大书名、作者署名、中间画面窗口、黄字字幕和底部声明。" },
    { id: "showcase", color: "#ffe135", title: "图书封面橱窗", desc: "强书名和中段画面窗口，适合主推带货口播。" },
    { id: "notes", color: "#b44735", title: "划重点笔记", desc: "纸张笔记感和重点标签，适合方法论与健康科普。" },
    { id: "quote", color: "#f7f7f7", title: "金句冲击卡", desc: "大字金句开头，适合反常识和强观点。" },
    { id: "chapters", color: "#9fd3cd", title: "章节进度条", desc: "顶部进度条和章节标题，适合长口播降低跳出。" },
    { id: "desk", color: "#d8c49b", title: "书桌电影感", desc: "全屏质感画面和低干扰字幕，适合人生认知类。" },
  ];
  const motionList = [
    { id: "cinematic", title: "电影感", desc: "慢速横移 + 柔和影调" },
    { id: "quick", title: "动感快剪", desc: "快速平移 + 高对比色彩" },
    { id: "calm", title: "静帧放大", desc: "居中轻放大 + 低饱和影调" },
    { id: "collage", title: "胶片复古", desc: "复古色调 + 轻颗粒质感" },
  ];
  const baseTotal = Object.values(counts).reduce((sum: number, n: any) => sum + Math.max(0, Number(n || 0)), 0);
  const selectedMotionCount = Object.values(motions).filter(Boolean).length;
  const motionTotal = Math.max(1, selectedMotionCount);
  const total = baseTotal * motionTotal;
  const overLimit = total > MAX_RENDER_VIDEOS;
  const renderRunning = renderStep?.status === "running";
  const locked = busy || renderRunning || workflowRunning;
  const hasMissingDeps = Array.isArray(renderMissing) && renderMissing.length > 0;
  const canStartWorkflow = !locked && total > 0 && !overLimit;
  const renderButtonText = renderRunning
    ? "视频生成中"
    : workflowRunning
      ? "流程运行中"
      : overLimit
        ? `最多 ${MAX_RENDER_VIDEOS} 条`
        : hasMissingDeps
          ? `补齐流程并生成 ${Math.max(total, 1)} 条视频`
          : `生成 ${Math.max(total, 1)} 条视频`;
  const filledStatement = statement
    .replaceAll("{author}", task.bookAuthor || book.book_author || task.author || "作者")
    .replaceAll("{title}", task.bookTitle || book.book_title || task.title || "书名");

  const updateCount = (id: string, delta: number) => {
    if (renderRunning) return;
    setCounts((prev: any) => {
      const current = Number(prev[id] || 0);
      const nextValue = Math.max(0, Math.min(9, current + delta));
      const nextBaseTotal = Object.entries(prev).reduce((sum: number, [key, value]: any) => {
        const n = key === id ? nextValue : Number(value || 0);
        return sum + Math.max(0, n);
      }, 0);
      if (delta > 0 && nextBaseTotal * motionTotal > MAX_RENDER_VIDEOS) return prev;
      return { ...prev, [id]: nextValue };
    });
  };
  const canEnableMotion = (id: string) => {
    if (motions[id]) return true;
    const nextMotionTotal = Math.max(1, selectedMotionCount + 1);
    return baseTotal * nextMotionTotal <= MAX_RENDER_VIDEOS;
  };
  const saveRenderConfig = async () => {
    if (renderRunning) return false;
    const renderEngine = engine === "ffmpeg" ? "ffmpeg" : "auto";
    if (setEngine) setEngine(renderEngine);
    return await saveTaskConfig("render", {
      engine: renderEngine,
      background: "images",
      styleCounts: counts,
      motionPresets: motions,
      styles: counts,
      motions,
      statement,
    }, "保存声明");
  };
  const generateVideos = async () => {
    if (locked) return;
    const imageTargetCount = imageTarget === "auto" ? 0 : Math.max(0, Math.min(90, Number(imageTarget) || 0));
    const normalizedImageMode = imageMode === "wide" ? "wide" : "square";
    const normalizedImageQuality = imageQuality === "fast" ? "fast" : "high";
    if (!(await saveTaskConfig("images", { targetCount: imageTargetCount, mode: normalizedImageMode, style: imageStyle, quality: normalizedImageQuality }, "保存图片配置"))) return;
    if (!(await saveRenderConfig())) return;
    await act(canRender ? (renderCount ? "rerun" : "run") : "pipeline", canRender ? "render" : undefined);
  };

  return (
    <section className="video-style-workspace">
      <div className="stage-banner compact">
        <span>STEP 06</span>
        <h2>成片风格与数量</h2>
        <p>短视频优先 HyperFrames 合成，长视频自动走快速兜底，选 motion preset 与版本数量。有书籍信息时会按图书成片样式输出。</p>
        <strong>完成后 · 生成成片</strong>
      </div>

      <div className="video-style-head">
        <div>
          <div className="section-kicker">VIDEO STYLES</div>
          <h2>成片风格与数量</h2>
        </div>
        <div className="render-action-wrap">
          <button className="btn btn-ok" disabled={!canStartWorkflow} onClick={generateVideos}>
            {renderButtonText}
          </button>
          {hasMissingDeps && !workflowRunning && (
            <span>会先补齐：{renderMissing.join("、")}</span>
          )}
        </div>
      </div>

      {(renderRunning || workflowRunning || hasMissingDeps) && (
        <div className="render-lock-note">
          {renderRunning
            ? "当前正在生成视频，本次会按启动时已保存的配置执行。完成后再修改风格或动效。"
            : workflowRunning
              ? "流程正在运行，系统会按顺序补齐音频、字幕、图片和视频。"
              : `当前还缺少 ${renderMissing.join("、")}，点击生成会先自动补齐这些步骤。`}
        </div>
      )}

      <div className="style-picker-panel">
        <div className="style-section-title">
          <span>视频风格</span>
          <em>可多选，每种风格可单独调整生成数量</em>
        </div>
        <div className="style-options">
          {styles.map((style) => (
            <div className={`style-option ${counts[style.id] > 0 ? "selected" : ""}`} key={style.id}>
              <div className="style-dot" style={{ background: style.color }} />
              <div>
                <strong>{style.title}</strong>
                <p>{style.desc}</p>
              </div>
              <div className="count-stepper">
                <button onClick={() => updateCount(style.id, -1)} disabled={locked || counts[style.id] <= 0}>-</button>
                <span>{counts[style.id] || 0}</span>
                <button onClick={() => updateCount(style.id, 1)} disabled={locked || baseTotal >= MAX_RENDER_VIDEOS || (baseTotal + 1) * motionTotal > MAX_RENDER_VIDEOS}>+</button>
              </div>
            </div>
          ))}
        </div>

        <div className="motion-section">
          <div className="style-section-title">
            <span>动效预设</span>
            <em>可多选，每多选一个预设视为每个视频风格多生成一条成片；单次最多 {MAX_RENDER_VIDEOS} 条</em>
          </div>
          <div className="motion-options">
            {motionList.map((motion) => (
              <label className={`motion-option ${motions[motion.id] ? "selected" : ""}`} key={motion.id}>
                <input
                  type="checkbox"
                  checked={!!motions[motion.id]}
                  disabled={locked || !canEnableMotion(motion.id)}
                  onChange={(e) => setMotions((prev: any) => ({ ...prev, [motion.id]: e.target.checked }))}
                />
                <strong>{motion.title}</strong>
                <span>{motion.desc}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="statement-panel">
        <div className="statement-copy">
          <p>声明模板会用于知识类成片模板，包括章节进度条、暗色知识卡片、图书口播卡片、图书封面橱窗、划重点笔记和书桌电影感；留空则使用全局默认模板。</p>
          <label>
            <span>快速选择模板</span>
            <select
              className="field dashboard-select"
              onChange={(e) => {
                if (!e.target.value) return;
                setStatement(e.target.value);
              }}
              defaultValue=""
            >
              <option value="">-- 选择预设模板 --</option>
              <option value={"本视频基于{author}《{title}》及相关研究资料整理\n仅用于健康科普分享，不构成任何建议或行为指导。"}>健康科普声明</option>
              <option value={"本视频基于《{title}》内容整理\n仅代表读书笔记与个人理解，不作为任何决策依据。"}>读书笔记声明</option>
              <option value={"素材来源于公开资料与《{title}》相关内容\n仅用于知识分享，版权归原作者所有。"}>公开资料声明</option>
            </select>
          </label>
          <textarea className="field statement-area" value={statement} disabled={locked} onChange={(e) => setStatement(e.target.value)} />
          <small>支持占位符 {"{author}"}（作者）和 {"{title}"}（书名）。已输入 {statement.length} 字</small>
        </div>
        <div className="statement-preview">
          <strong>声明预览</strong>
          <p>{filledStatement}</p>
          <button className="btn btn-ghost" disabled={locked} onClick={saveRenderConfig}>保存声明</button>
        </div>
      </div>
    </section>
  );
}
