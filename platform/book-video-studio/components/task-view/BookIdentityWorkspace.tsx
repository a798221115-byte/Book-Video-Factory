"use client";

import { useEffect, useMemo, useState } from "react";
import { copyTextToClipboard } from "./clipboard";

const COVER_STYLE_OPTIONS = [
  { id: "celestial", label: "灵性星光" },
  { id: "editorial", label: "水墨文学" },
  { id: "cinematic", label: "电影写作桌" },
  { id: "abstract", label: "抽象几何" },
];

export default function BookIdentityWorkspace({ task, book, draft, setDraft, scriptText, titleSeed, setTitleSeed, busy, canIdentify, act, saveBookInfo, rewriteConfig, saveTaskConfig, sourceCoverUrl = "", generatedCovers = [] }: any) {
  const fallbackVideoTitles = useMemo(
    () => buildVideoTitles(draft.bookTitle || book.book_title || task.title || "这本书", scriptText, titleSeed),
    [book.book_title, draft.bookTitle, scriptText, task.title, titleSeed],
  );
  const fallbackShortTitles = useMemo(
    () => buildShortTitles(draft.bookTitle || book.book_title || task.title || "好书", scriptText, titleSeed),
    [book.book_title, draft.bookTitle, scriptText, task.title, titleSeed],
  );
  const fallbackHashtags = useMemo(
    () => buildHashtags(draft.bookTitle || book.book_title || task.title || "这本书", scriptText, titleSeed),
    [book.book_title, draft.bookTitle, scriptText, task.title, titleSeed],
  );
  const savedVideoTitleValues = Array.isArray(book.video_titles) ? book.video_titles.filter(Boolean) : [];
  const savedVideoTitles = uniqueTitles(savedVideoTitleValues.map(stripHashtags));
  const savedShortTitles = Array.isArray(book.short_titles) ? book.short_titles.filter(Boolean) : [];
  const savedHashtags = uniqueHashtags([
    ...(Array.isArray(book.hashtags) ? book.hashtags : []),
    ...extractHashtags(savedVideoTitleValues),
  ]);
  const savedTitlesKey = `${savedVideoTitleValues.join("\n")}::${savedShortTitles.join("\n")}::${savedHashtags.join(" ")}`;
  const savedTitleProvider = String(book.title_provider || "").trim();
  const savedTitleGeneratedAt = Number(book.title_generated_at || 0);
  const [titleState, setTitleState] = useState({
    videoTitles: savedVideoTitles.length ? savedVideoTitles : fallbackVideoTitles,
    shortTitles: savedShortTitles.length ? savedShortTitles : fallbackShortTitles,
    hashtags: savedHashtags.length ? savedHashtags : fallbackHashtags,
    provider: savedTitleProvider || (savedVideoTitles.length || savedShortTitles.length || savedHashtags.length ? "saved" : "local"),
    generatedAt: savedTitleGeneratedAt || Number(book.saved_at || 0) || Date.now(),
    warning: "",
  });
  const [generatingTitles, setGeneratingTitles] = useState(false);
  const [coverStyle, setCoverStyle] = useState("celestial");
  const [generatingCover, setGeneratingCover] = useState(false);
  const [coverError, setCoverError] = useState("");
  const [localGeneratedCovers, setLocalGeneratedCovers] = useState<any[]>([]);
  const [previewCover, setPreviewCover] = useState<any>(null);
  const [autoTitleTaskId, setAutoTitleTaskId] = useState("");
  const [autoTitleAttempted, setAutoTitleAttempted] = useState(false);

  useEffect(() => {
    setTitleState({
      videoTitles: savedVideoTitles.length ? savedVideoTitles : fallbackVideoTitles,
      shortTitles: savedShortTitles.length ? savedShortTitles : fallbackShortTitles,
      hashtags: savedHashtags.length ? savedHashtags : fallbackHashtags,
      provider: savedTitleProvider || (savedVideoTitles.length || savedShortTitles.length || savedHashtags.length ? "saved" : "local"),
      generatedAt: savedTitleGeneratedAt || Number(book.saved_at || 0) || Date.now(),
      warning: "",
    });
  }, [book.saved_at, fallbackHashtags, fallbackShortTitles, fallbackVideoTitles, savedTitleGeneratedAt, savedTitleProvider, savedTitlesKey]);

  useEffect(() => {
    if (!previewCover) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewCover(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewCover]);

  const confidence = Math.round(Number(book.confidence || 0) * 100);
  const coverUrl = String(draft.coverUrl || sourceCoverUrl || "").trim();
  const hasSourceCover = Boolean(String(sourceCoverUrl || "").trim());
  const coverCandidates = useMemo(
    () => mergeCoverCandidates(localGeneratedCovers, book.cover_candidates, generatedCovers),
    [book.cover_candidates, generatedCovers, localGeneratedCovers],
  );
  const copy = (text: string) => { copyTextToClipboard(text); };
  const copyAllHashtags = () => { copy(titleState.hashtags.join(" ")); };
  const hasSavedAiTitles = Boolean(savedTitleProvider || savedTitleGeneratedAt);
  const generateTitles = async () => {
    if (generatingTitles) return;
    setGeneratingTitles(true);
    try {
      const resp = await fetch(`/api/tasks/${task.id}/titles`, { method: "POST" });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(String(payload?.error || `${resp.status} ${resp.statusText}`));
      setTitleState({
        videoTitles: Array.isArray(payload.videoTitles) && payload.videoTitles.length ? uniqueTitles(payload.videoTitles.map(stripHashtags)) : fallbackVideoTitles,
        shortTitles: Array.isArray(payload.shortTitles) && payload.shortTitles.length ? payload.shortTitles : fallbackShortTitles,
        hashtags: Array.isArray(payload.hashtags) && payload.hashtags.length ? uniqueHashtags(payload.hashtags) : fallbackHashtags,
        provider: payload.ai === false ? "local" : payload.provider || "ai",
        generatedAt: Number(payload.generatedAt || Date.now()),
        warning: payload.ai === false
          ? `AI 标题通道失败，当前为本地兜底：${String(payload.warning || "").trim()}`
          : String(payload.warning || ""),
      });
    } catch (e: any) {
      setTitleSeed((n: number) => n + 1);
      setTitleState({
        videoTitles: fallbackVideoTitles,
        shortTitles: fallbackShortTitles,
        hashtags: fallbackHashtags,
        provider: "local",
        generatedAt: Date.now(),
        warning: String(e?.message || e),
      });
    } finally {
      setGeneratingTitles(false);
    }
  };

  useEffect(() => {
    if (!task?.id || autoTitleTaskId === task.id || hasSavedAiTitles) return;
    setAutoTitleAttempted(true);
    setAutoTitleTaskId(task.id);
    generateTitles();
  }, [autoTitleTaskId, hasSavedAiTitles, task?.id]);
  const identifyBook = async () => {
    const notes = typeof rewriteConfig?.notes === "string" ? rewriteConfig.notes : "";
    if (!(await saveTaskConfig("rewrite", { notes, rewriteNotes: notes }, "保存改写要求"))) return;
    await act("rerun", "rewrite");
  };
  const generateCover = async (allStyles = false) => {
    if (generatingCover) return;
    setGeneratingCover(true);
    setCoverError("");
    try {
      const resp = await fetch(`/api/tasks/${task.id}/book/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookTitle: draft.bookTitle || book.book_title || task.title || "",
          bookAuthor: draft.bookAuthor || book.book_author || task.author || "",
          ...(allStyles ? { styles: COVER_STYLE_OPTIONS.map((option) => option.id) } : { style: coverStyle }),
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(String(payload?.error || `${resp.status} ${resp.statusText}`));
      const nextCoverUrl = String(payload.coverUrl || "");
      if (!nextCoverUrl) throw new Error("生图接口未返回封面地址");
      const nextCovers = Array.isArray(payload.covers) ? payload.covers : [{ label: COVER_STYLE_OPTIONS.find((option) => option.id === coverStyle)?.label, url: nextCoverUrl, style: coverStyle }];
      setLocalGeneratedCovers((prev) => mergeCoverCandidates(nextCovers, prev));
      setDraft((prev: any) => ({ ...prev, coverUrl: nextCoverUrl }));
    } catch (e: any) {
      setCoverError(String(e?.message || e));
    } finally {
      setGeneratingCover(false);
    }
  };

  return (
    <section className="book-workspace">
      <div className="stage-banner">
        <span>STEP 05</span>
        <h2>书籍信息</h2>
        <p>确认书名、作者、封面图，用于成片片尾水印与视频号标题。</p>
        <strong>完成后 · 选择成片风格</strong>
      </div>

      <div className="section-head book-head">
        <div>
          <div className="section-kicker">BOOK IDENTITY</div>
          <h2>书籍信息</h2>
        </div>
        <div className="section-actions">
          <button className="btn btn-ghost" disabled={busy || !canIdentify} onClick={identifyBook}>AI 识别书籍信息</button>
          <button
            className="btn btn-ok"
            disabled={busy}
            onClick={() => saveBookInfo({
              bookTitle: draft.bookTitle,
              bookAuthor: draft.bookAuthor,
              coverUrl: draft.coverUrl,
              videoTitles: titleState.videoTitles,
              shortTitles: titleState.shortTitles,
              hashtags: titleState.hashtags,
            })}
          >
            保存书籍信息
          </button>
        </div>
      </div>

      <div className="book-form-card">
        <label>
          <span>书籍名</span>
          <input
            className="field dashboard-input"
            value={draft.bookTitle}
            onChange={(e) => setDraft((prev: any) => ({ ...prev, bookTitle: e.target.value }))}
            placeholder="请输入书名"
          />
        </label>
        <label>
          <span>作者名称</span>
          <input
            className="field dashboard-input"
            value={draft.bookAuthor}
            onChange={(e) => setDraft((prev: any) => ({ ...prev, bookAuthor: e.target.value }))}
            placeholder="请输入作者"
          />
        </label>
        <div className="cover-editor">
          <label className="cover-input">
            <span>封面图 URL</span>
            <input
              className="field dashboard-input"
              value={draft.coverUrl}
              onChange={(e) => setDraft((prev: any) => ({ ...prev, coverUrl: e.target.value }))}
              placeholder={hasSourceCover ? "已从采集视频获取封面，可直接保存" : "可粘贴封面图链接"}
            />
          </label>
          {coverUrl ? (
            <button
              type="button"
              className="cover-preview"
              onClick={() => setPreviewCover({ label: "当前封面", url: coverUrl })}
            >
              <img src={coverUrl} alt="书籍封面预览" referrerPolicy="no-referrer" />
            </button>
          ) : (
            <div className="cover-preview empty">
              <span>暂无封面</span>
            </div>
          )}
          <div className="cover-actions">
            <select
              className="field dashboard-select cover-style-select"
              value={coverStyle}
              disabled={busy || generatingCover}
              onChange={(e) => setCoverStyle(e.target.value)}
            >
              {COVER_STYLE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ok"
              disabled={busy || generatingCover}
              onClick={() => generateCover(false)}
            >
              {generatingCover ? "AI 生成中..." : "AI 生成封面"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || generatingCover}
              onClick={() => generateCover(true)}
            >
              生成全部风格
            </button>
            {hasSourceCover && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => setDraft((prev: any) => ({ ...prev, coverUrl: sourceCoverUrl }))}
              >
                使用采集封面
              </button>
            )}
            {draft.coverUrl && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => setDraft((prev: any) => ({ ...prev, coverUrl: "" }))}
              >
                清空封面
              </button>
            )}
            {coverError && <span className="cover-error">{coverError}</span>}
          </div>
        </div>
        {coverCandidates.length > 0 && (
          <div className="cover-candidate-panel">
            <div className="cover-candidate-head">
              <strong>AI 封面候选</strong>
              <span>点击放大预览，确认后再使用</span>
            </div>
            <div className="cover-candidate-grid">
              {coverCandidates.map((item: any, index: number) => {
                const candidateUrl = String(item?.url || "");
                const selected = candidateUrl && draft.coverUrl === candidateUrl;
                return (
                  <button
                    key={`${candidateUrl}-${index}`}
                    type="button"
                    className={`cover-candidate ${selected ? "selected" : ""}`}
                    disabled={busy || !candidateUrl}
                    onClick={() => setPreviewCover(item)}
                  >
                    <img src={candidateUrl} alt={`${item?.label || "AI 封面"}候选`} />
                    <span>{selected ? `${item?.label || `候选 ${index + 1}`} · 已选` : item?.label || `候选 ${index + 1}`}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {previewCover?.url && (
          <div className="cover-lightbox" role="dialog" aria-modal="true" aria-label="封面大图预览" onClick={() => setPreviewCover(null)}>
            <div className="cover-lightbox-panel" onClick={(event) => event.stopPropagation()}>
              <div className="cover-lightbox-head">
                <strong>{previewCover.label || "封面预览"}</strong>
                <button type="button" className="btn btn-ghost" onClick={() => setPreviewCover(null)}>关闭</button>
              </div>
              <div className="cover-lightbox-stage">
                <img src={previewCover.url} alt={`${previewCover.label || "封面"}大图预览`} referrerPolicy="no-referrer" />
              </div>
              <div className="cover-lightbox-actions">
                <span>{draft.coverUrl === previewCover.url ? "当前正在使用这张封面" : "预览完整封面效果"}</span>
                <button
                  type="button"
                  className="btn btn-ok"
                  disabled={busy}
                  onClick={() => {
                    setDraft((prev: any) => ({ ...prev, coverUrl: previewCover.url }));
                    setPreviewCover(null);
                  }}
                >
                  使用这张封面
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="book-evidence">
          <strong>{confidence ? `置信度 ${confidence}%` : "等待识别"}</strong>
          <p>{book.evidence || "运行书名识别后，这里会显示识别依据。"}</p>
        </div>
      </div>

      <div className="title-card-panel">
        <div className="title-panel-head">
          <div>
            <h3>视频号标题</h3>
            <p>
              最近生成：{new Date(titleState.generatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}。
              {generatingTitles ? "AI 标题生成中。" : titleState.provider === "local" ? (autoTitleAttempted ? "AI 未成功返回，当前为本地兜底标题。" : "当前为本地兜底标题。") : `来源：${titleState.provider}。`}
              已按推荐度降序排列，点击任意卡片即可复制。
            </p>
            {titleState.warning && <p>AI 标题生成失败，已使用兜底：{titleState.warning}</p>}
          </div>
          <button className="btn btn-ghost" disabled={busy || generatingTitles} onClick={generateTitles}>
            {generatingTitles ? "AI 生成中..." : hasSavedAiTitles || titleState.provider !== "local" ? "重新生成视频号标题" : "AI 生成视频号标题"}
          </button>
        </div>
        <div className="title-columns">
          <div>
            <h4>长标题 · 不含话题</h4>
            <div className="title-list">
              {titleState.videoTitles.map((t: string, i: number) => (
                <button key={i} onClick={() => copy(t)}>{t}</button>
              ))}
            </div>
          </div>
          <div>
            <h4>短标题 · 封面文案</h4>
            <div className="title-list compact">
              {titleState.shortTitles.map((t: string, i: number) => (
                <button key={i} onClick={() => copy(t)}>{t}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="hashtag-panel">
          <div className="hashtag-panel-head">
            <h4>话题标签 · 单独复制</h4>
            <button className="btn btn-ghost" onClick={copyAllHashtags}>复制全部话题</button>
          </div>
          <button className="hashtag-copy-box" onClick={copyAllHashtags}>
            {titleState.hashtags.join(" ")}
          </button>
          <div className="hashtag-list">
            {titleState.hashtags.map((tag: string, i: number) => (
              <button key={`${tag}-${i}`} onClick={() => copy(tag)}>{tag}</button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function stripHashtags(value: string) {
  return String(value || "")
    .replace(/[#＃][\p{L}\p{N}_\u4e00-\u9fff-]+/gu, "")
    .replace(/\s+/g, " ")
    .replace(/[，,、\s]+$/g, "")
    .trim();
}

function cleanHashtag(value: unknown) {
  const raw = String(value || "")
    .replace(/\s+/g, "")
    .replace(/^[-\d.、]+/, "")
    .trim();
  const text = raw.replace(/^[#＃]+/, "").replace(/[^\p{L}\p{N}_\u4e00-\u9fff]/gu, "").slice(0, 16);
  return text ? `#${text}` : "";
}

function extractHashtags(values: unknown[]) {
  const out: string[] = [];
  for (const value of values) {
    out.push(...(String(value || "").match(/[#＃][\p{L}\p{N}_\u4e00-\u9fff-]+/gu) || []));
  }
  return out;
}

function uniqueHashtags(values: unknown[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const tag = cleanHashtag(value);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function uniqueTitles(values: unknown[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const title = String(value || "").trim();
    const key = title.replace(/[《》#＃\s，。,.!！?？、]/g, "");
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

function mergeCoverCandidates(...groups: unknown[]) {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const url = String((item as any)?.url || "");
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(item);
    }
  }
  return out.slice(0, 24);
}

function buildVideoTitles(bookTitle: string, scriptText: string, seed: number) {
  const cleanBook = bookTitle.replace(/[《》]/g, "").trim() || "这本书";
  const theme = scriptText.includes("健康") ? "健康" : scriptText.includes("人生") ? "人生" : "认知";
  const pool = [
    `读完《${cleanBook}》才明白，真正拉开差距的不是努力，而是长期选择`,
    `如果你也在寻找改变现状的方法，这本《${cleanBook}》值得认真看完`,
    `《${cleanBook}》里最扎心的一句话：很多问题，都是长期忽视带来的`,
    `别等到状态下滑才重视自己，《${cleanBook}》把底层逻辑讲透了`,
    `这本书适合反复看，每一章都在提醒你重新安排生活的优先级`,
    `看完《${cleanBook}》，我终于理解为什么有些人越活越稳`,
  ];
  return rotate(pool, seed).slice(0, 4);
}

function buildShortTitles(bookTitle: string, scriptText: string, seed: number) {
  const cleanBook = bookTitle.replace(/[《》]/g, "").trim() || "好书";
  const keyword = scriptText.includes("健康") ? "健康" : scriptText.includes("衰老") ? "衰老" : "人生";
  const pool = [
    `这本书讲透${keyword}`,
    `越早读越受益`,
    `重新认识自己`,
    `《${cleanBook}》`,
    `别忽视长期选择`,
    `把生活排个序`,
  ];
  return rotate(pool, seed).slice(0, 4);
}

function buildHashtags(bookTitle: string, scriptText: string, seed: number) {
  const cleanBook = bookTitle.replace(/[《》#＃]/g, "").replace(/\s+/g, "").trim() || "好书";
  const theme = scriptText.includes("健康") ? "健康" : scriptText.includes("关系") ? "关系" : scriptText.includes("情绪") ? "情绪管理" : "成长";
  const pool = [
    "#读书",
    "#好书推荐",
    "#图书分享",
    "#读书笔记",
    "#深度好书",
    "#书单",
    "#每日读书",
    "#自我提升",
    "#认知成长",
    "#个人成长",
    "#人生感悟",
    "#生活方式",
    "#情绪价值",
    "#普通人的成长",
    "#中年成长",
    "#知识分享",
    "#视频号运营",
    "#短视频文案",
    `#${theme}`,
    "#阅读分享",
    "#书摘",
    "#每天一本书",
    "#长期主义",
    "#成长思维",
    "#情绪管理",
    "#心理成长",
    "#女性成长",
    "#男性成长",
    "#家庭关系",
    "#亲子教育",
    "#普通人逆袭",
    `#${cleanBook.slice(0, 12)}`,
  ];
  return rotate(uniqueHashtags(pool), seed).slice(0, 28);
}

function rotate<T>(arr: T[], seed: number) {
  const n = arr.length ? seed % arr.length : 0;
  return arr.slice(n).concat(arr.slice(0, n));
}
