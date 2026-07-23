"use client";

import { fmtDuration } from "./shared";

type Check = {
  label: string;
  value: string;
  ok: boolean;
  hint: string;
};

function countSelected(map: Record<string, unknown> | undefined) {
  return Object.values(map || {}).reduce<number>((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
}

function selectedMotions(map: Record<string, unknown> | undefined) {
  return Object.values(map || {}).filter(Boolean).length || 1;
}

function normalizeBookValue(value: unknown) {
  return String(value || "").trim();
}

export default function PreflightPanel({
  task,
  book,
  rewriteText,
  rewriteSegmentsMeta,
  ttsArt,
  ttsMeta,
  subtitleReady,
  images,
  videoCover,
  imageTarget,
  imageMode,
  imageStyle,
  imageQuality,
  styleCounts,
  motionPresets,
  statement,
  renderMissing,
}: any) {
  const bookTitle = normalizeBookValue(task?.bookTitle || book?.book_title);
  const bookAuthor = normalizeBookValue(task?.bookAuthor || book?.book_author || task?.author);
  const rewriteChars = String(rewriteText || "").replace(/\s/g, "").length;
  const segments = Array.isArray(rewriteSegmentsMeta?.segments) ? rewriteSegmentsMeta.segments : [];
  const audioDur = Number(ttsMeta?.totalDur || 0);
  const imageCount = Array.isArray(images) ? images.length : 0;
  const autoTarget = imageTarget === "auto";
  const manualTarget = autoTarget ? 0 : Number(imageTarget || 0);
  const recommendedImages = autoTarget
    ? Math.max(9, Math.ceil(Math.max(segments.length, imageCount, 1) / 9) * 9)
    : manualTarget;
  const baseVideos = countSelected(styleCounts);
  const motionCount = selectedMotions(motionPresets);
  const videoCount = baseVideos * motionCount;
  const missing = Array.isArray(renderMissing) ? renderMissing : [];
  const checks: Check[] = [
    {
      label: "书名",
      value: bookTitle || "未填写",
      ok: !!bookTitle,
      hint: "用于封面、视频标题和声明模板。",
    },
    {
      label: "作者",
      value: bookAuthor || "未填写",
      ok: !!bookAuthor,
      hint: "用于口播归属和底部声明。",
    },
    {
      label: "改写稿",
      value: rewriteChars ? `${rewriteChars} 字` : "未生成",
      ok: rewriteChars > 0,
      hint: "TTS、字幕和场景图都按改写稿推进。",
    },
    {
      label: "口播分段",
      value: segments.length ? `${segments.length} 段` : "未分段",
      ok: segments.length > 0,
      hint: "图片数量会优先按正式分段估算。",
    },
    {
      label: "音频",
      value: ttsArt?.path ? `${fmtDuration(audioDur)} · ${ttsMeta?.voice || "默认音色"}` : "未生成",
      ok: !!ttsArt?.path,
      hint: "视频时长和字幕轴以最终音频为准。",
    },
    {
      label: "字幕",
      value: subtitleReady ? "已对齐" : "待对齐",
      ok: !!subtitleReady,
      hint: "缺字幕时生成视频会先自动补齐。",
    },
    {
      label: "视频首页图",
      value: videoCover?.path ? "已生成" : "未生成",
      ok: !!videoCover?.path,
      hint: "用于视频第一屏，和书籍封面、正文场景图分开。",
    },
    {
      label: "场景图",
      value: `${imageCount}/${recommendedImages || "自动"} 张`,
      ok: imageCount > 0 && (!recommendedImages || imageCount >= Math.min(9, recommendedImages)),
      hint: `${imageQuality === "fast" ? "快速九宫格" : "高规格九宫格"} · ${imageMode === "wide" ? "横版" : "方图"} · ${imageStyle}`,
    },
    {
      label: "声明模板",
      value: String(statement || "").trim() ? "已填写" : "使用默认",
      ok: true,
      hint: "章节进度条模板会带底部声明。",
    },
    {
      label: "输出版本",
      value: `${videoCount || 0} 条`,
      ok: videoCount > 0,
      hint: `${baseVideos || 0} 个风格 × ${motionCount} 个动效。`,
    },
  ];

  const readyCount = checks.filter((item) => item.ok).length;
  const hasBlockingMissing = missing.length > 0;

  return (
    <section className="preflight-panel" aria-label="渲染前检查">
      <div className="preflight-head">
        <div>
          <div className="section-kicker">PREFLIGHT</div>
          <h2>生成视频前确认</h2>
        </div>
        <strong>{readyCount}/{checks.length} 项就绪</strong>
      </div>
      {hasBlockingMissing && (
        <div className="preflight-missing">
          还缺少：{missing.join("、")}。点击生成视频时会先自动补齐这些步骤。
        </div>
      )}
      <div className="preflight-grid">
        {checks.map((item) => (
          <div className={`preflight-item ${item.ok ? "ok" : "warn"}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.hint}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
