"use client";

import { useEffect, useState } from "react";
import { fileUrl, fmtDuration, Metric, parseJson, summarizeStepError } from "./shared";
import { IMAGE_MODES, IMAGE_STYLES } from "./shared";

const PHASE_COPY: Record<string, string> = {
  briefs: "正在分析口播并生成画面 brief",
  generating: "正在准备生成批次",
  "grid:start": "正在启动九宫格大图生成",
  "grid:attempt": "正在提交九宫格生成请求",
  "grid:waiting": "图片模型生成中",
  "grid:response": "模型已返回，准备下载大图",
  "grid:download": "正在下载大图",
  "grid:retry": "本组生成失败，正在重试",
  "grid:cropping": "正在切分九宫格",
  "grid:saved": "本组候选图已保存",
  "grid:reused": "本组已生成，跳过复用",
  "grid:failed": "本组生成失败，继续下一组",
  "grid:unavailable": "本组通道超时或断连，继续下一组",
  "single:start": "正在启动单图生成",
  "single:attempt": "正在提交单图生成请求",
  "single:waiting": "图片模型生成中",
  "single:response": "模型已返回，准备下载单图",
  "single:download": "正在下载单图",
  "single:retry": "单图生成失败，正在重试",
  "single:saved": "单图已保存",
  "single:reused": "单图已生成，跳过复用",
  "single:failed": "单图生成失败，继续下一张",
  "single:unavailable": "单图通道超时或断连，继续下一张",
  "done": "全部候选图已生成",
  "done:partial": "部分候选图已生成",
};

function formatPhase(phase: unknown) {
  const key = String(phase || "");
  return PHASE_COPY[key] || (key ? `当前阶段：${key}` : "等待生成");
}

function percent(progress: unknown) {
  const n = Number(progress || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100)));
}

function formatRegeneratedAt(value: unknown) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return new Date(timestamp).toLocaleTimeString();
}

export default function ImageGenerationWorkspace({ images, imageStep, segmentCount = 0, videoCover, target, setTarget, mode, setMode, style, setStyle, quality, setQuality, busy, regeneratingImageId, canRun, blockedReason = "", act, saveTaskConfig, regenerateImage }: any) {
  const [previewImage, setPreviewImage] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const generated = images.length;
  const autoTarget = target === "auto";
  const progressMeta = parseJson(imageStep?.output);
  const resolvedTotal = Number(progressMeta.targetCount || 0);
  const total = autoTarget ? (resolvedTotal || generated || 0) : (Number(target) || 63);
  const effectiveTargetCount = autoTarget ? (resolvedTotal || 0) : total;
  const totalLabel = autoTarget && !total ? "自动" : `${total}`;
  const imageMode = mode === "wide" ? "wide" : "square";
  const imageStyle = IMAGE_STYLES.some((item) => item.id === style) ? style : "photo";
  const imageQuality = quality === "fast" ? "fast" : "high";
  const modeCopy = IMAGE_MODES.find((item) => item.id === imageMode) || IMAGE_MODES[0];
  const styleCopy = IMAGE_STYLES.find((item) => item.id === imageStyle) || IMAGE_STYLES[0];
  const gridImageSize = imageQuality === "high" ? modeCopy.highGridImageSize : modeCopy.imageSize;
  const imageStatus = imageStep?.status || "pending";
  const isRunning = imageStatus === "running";
  const isFailed = imageStatus === "failed";
  const progressPct = percent(imageStep?.progress);
  const providerEvent = progressMeta.providerEvent || {};
  const currentGrid = Number(progressMeta.currentGrid || 0);
  const totalGrids = Number(progressMeta.grids || Math.ceil(total / 9) || 0);
  const estimatedGroups = Math.max(1, Math.ceil((total || Math.max(9, segmentCount || generated || 9)) / 9));
  const currentCell = Number(progressMeta.currentCell || 0);
  const currentGridSize = Number(progressMeta.currentGridSize || 0);
  const savedCells = Number(progressMeta.savedCells || progressMeta.cells || generated || 0);
  const reusedCells = Number(progressMeta.reusedCells || 0);
  const failedGridCount = Number(progressMeta.failedGridCount || 0);
  const channelIssueGridCount = Number(progressMeta.channelIssueGridCount || 0);
  const hasKnownMissing = total > 0 && generated < total;
  const canResumeMissing = !isRunning && canRun && (hasKnownMissing || failedGridCount > 0 || channelIssueGridCount > 0);
  const phaseText = isFailed ? "生成失败" : formatPhase(progressMeta.phase);
  const elapsedText = providerEvent.elapsedSeconds
    ? `已等待 ${fmtDuration(providerEvent.elapsedSeconds)}`
    : "";
  const timeoutText = providerEvent.timeoutSeconds
    ? `本次上限 ${fmtDuration(providerEvent.timeoutSeconds)}`
    : "";
  const detailParts = [
    currentGrid ? `第 ${currentGrid}/${totalGrids || "?"} 组` : "",
    currentCell ? `第 ${currentCell}/${currentGridSize || "?"} 张` : "",
    savedCells ? `已保存 ${savedCells} 张` : "",
    reusedCells ? `复用 ${reusedCells} 张` : "",
    elapsedText,
    timeoutText,
  ].filter(Boolean);
  const runButtonLabel = isRunning
    ? `${phaseText} ${progressPct}%`
    : autoTarget && !total
      ? "按配音分段生成场景图"
      : hasKnownMissing
        ? `补齐到 ${totalLabel} 张场景图`
        : generated
          ? `检查并补齐 ${totalLabel} 张场景图`
          : `生成 ${totalLabel} 张场景图`;
  const disabledReason = isRunning
    ? "图片正在生成中"
    : !canRun
      ? blockedReason || "需要先完成上游步骤"
      : busy
        ? "后台请求处理中"
        : "";
  const grouped = images.map((a: any, index: number) => {
    let meta: any = {};
    try { meta = a.meta ? JSON.parse(a.meta) : {}; } catch { meta = {}; }
    return { artifact: a, meta, group: Math.floor(index / 9) + 1, cell: (index % 9) + 1 };
  });
  const runImages = async () => {
    const targetCount = autoTarget ? effectiveTargetCount : total;
    if (!(await saveTaskConfig("images", { targetCount, mode: imageMode, style: imageStyle, quality: imageQuality, resume: true }, "保存图片配置"))) return;
    await act(images.length ? "rerun" : "run", "images");
  };
  const regenerateAllImages = async () => {
    const targetCount = autoTarget ? effectiveTargetCount : total;
    if (!(await saveTaskConfig("images", { targetCount, mode: imageMode, style: imageStyle, quality: imageQuality, resume: false }, "保存图片配置"))) return;
    await act(images.length ? "rerun" : "run", "images");
  };
  const refreshHealth = async () => {
    setHealthLoading(true);
    try {
      const res = await fetch("/api/image/health", { cache: "no-store" });
      setHealth(await res.json());
    } catch (error: any) {
      setHealth({ ok: false, channels: [], error: String(error?.message || error) });
    } finally {
      setHealthLoading(false);
    }
  };
  useEffect(() => {
    refreshHealth();
  }, []);
  useEffect(() => {
    if (!previewImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewImage(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewImage]);

  return (
    <section className="image-workspace">
      <div className="image-head">
        <div>
          <div className="section-kicker">IMAGE GENERATION</div>
          <h2>AI 场景图生成</h2>
        </div>
        <div className="image-action-wrap">
          <button className="btn btn-ok image-run-button" disabled={busy || isRunning || !canRun} onClick={runImages}>
            {isRunning && <span className="inline-spinner" aria-hidden="true" />}
            {runButtonLabel}
          </button>
          {generated > 0 && !isRunning && (
            <button className="btn btn-ghost image-run-button" disabled={busy || !canRun} onClick={regenerateAllImages}>
              全部重生
            </button>
          )}
          {disabledReason && <span>{disabledReason}</span>}
        </div>
      </div>

      <div className="image-control-grid">
        <label className="image-select-card">
          <span>候选张数</span>
          <select className="field dashboard-select" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="auto">按配音分段自动</option>
            <option value="18">18 张</option>
            <option value="27">27 张</option>
            <option value="36">36 张</option>
            <option value="45">45 张</option>
            <option value="54">54 张</option>
            <option value="63">63 张</option>
          </select>
        </label>
        <label className="image-select-card">
          <span>画幅模式</span>
          <select className="field dashboard-select" value={imageMode} onChange={(e) => setMode(e.target.value)}>
            {IMAGE_MODES.map((item) => (
              <option value={item.id} key={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="image-select-card">
          <span>视觉风格</span>
          <select className="field dashboard-select" value={imageStyle} onChange={(e) => setStyle(e.target.value)}>
            {IMAGE_STYLES.map((item) => (
              <option value={item.id} key={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="image-select-card">
          <span>生成清晰度</span>
          <select className="field dashboard-select" value={imageQuality} onChange={(e) => setQuality(e.target.value)}>
            <option value="high">高规格九宫格</option>
            <option value="fast">快速九宫格</option>
          </select>
        </label>
        <div className="image-mode-card">
          <h3>{imageQuality === "high" ? "高规格九宫格生成候选" : "快速九宫格生成候选"}</h3>
          <p>{modeCopy.hint}；{styleCopy.hint}；系统内部按 9 张一组生成大图并切分。</p>
        </div>
        <Metric label="已有候选" value={autoTarget && !total ? `${generated} 张已生成` : `${generated}/${totalLabel} 张已生成`} />
        <Metric label={isRunning ? "生成进度" : "下一次生成"} value={isRunning ? `${progressPct}%` : autoTarget && !total ? "按配音分段" : `${totalLabel} 张`} />
        <Metric label="内部模式" value={`${modeCopy.label} · 3x3 九宫格切分 · ${gridImageSize}`} />
        <Metric label="预计组数" value={`${estimatedGroups} 组 · 约 ${estimatedGroups * 9} 张`} />
        <Metric label="图片风格" value={styleCopy.label} />
        <Metric label="当前状态" value={isFailed ? "生成失败" : isRunning ? "生成中" : generated ? "图片已就绪" : "等待生成"} />
      </div>

      <div className="image-health-panel">
        <div className="image-health-head">
          <div>
            <strong>生图通道</strong>
            <span>{health?.channels?.length ? `${health.channels.length} 个通道 · ${health.ok ? "至少一个可用" : "全部异常或不可探测"}` : "等待检测"}</span>
          </div>
          <button className="btn btn-ghost" disabled={healthLoading} onClick={refreshHealth}>
            {healthLoading ? "检测中" : "重新检测"}
          </button>
        </div>
        <div className="image-health-grid">
          {(health?.channels || []).map((channel: any) => (
            <div className={`image-health-item ${channel.ok ? "ok" : "warn"}`} key={`${channel.name}-${channel.baseUrl}`}>
              <strong>{channel.name}</strong>
              <span>{channel.model} · {channel.keyHint}</span>
              <p>{channel.ok ? "可访问" : "异常"} · {channel.latencyMs || 0}ms · {channel.message}</p>
            </div>
          ))}
          {health?.error && <div className="image-health-item warn"><strong>检测失败</strong><p>{health.error}</p></div>}
        </div>
      </div>

      {videoCover?.path && (
        <div className="video-cover-inline">
          <strong>视频首页图已就绪</strong>
          <span>渲染时会优先作为第一张画面参与成片。</span>
          <button
            type="button"
            className="candidate-image-button"
            onClick={() => setPreviewImage({ url: fileUrl(videoCover.path), label: videoCover.label || "视频首页图", brief: "视频第一屏", meta: parseJson(videoCover.meta) })}
          >
            <img src={fileUrl(videoCover.path)} alt="视频首页图" />
          </button>
        </div>
      )}

      {(isRunning || isFailed || failedGridCount > 0 || channelIssueGridCount > 0) && (
        <div className={`image-progress-panel ${isFailed ? "failed" : ""}`}>
          <div className="image-progress-head">
            <div>
              <strong>{phaseText}</strong>
              <span>{detailParts.length ? detailParts.join(" · ") : "等待后台返回进度"}</span>
            </div>
            <em>{progressPct}%</em>
          </div>
          <div className="image-progress-track" aria-label="图片生成进度">
            <span style={{ width: `${progressPct}%` }} />
          </div>
          {failedGridCount > 0 && !isFailed && (
            <p>已有 {failedGridCount} 组接口返回错误。可点击上方“{canResumeMissing ? runButtonLabel : "补齐"}”继续补缺口。</p>
          )}
          {channelIssueGridCount > 0 && !isFailed && (
            <p>已有 {channelIssueGridCount} 组通道超时或断连，未计为接口失败；可手动补齐缺失图片。</p>
          )}
          {hasKnownMissing && !isRunning && !isFailed && (
            <p>当前缺少 {Math.max(0, total - generated)} 张。点击补齐会复用已有图片，只生成缺口。</p>
          )}
          {canResumeMissing && (
            <div className="image-progress-actions">
              <button className="btn btn-ok" disabled={busy} onClick={runImages}>补齐缺失图片</button>
              <button className="btn btn-ghost" disabled={busy} onClick={regenerateAllImages}>全部重生</button>
            </div>
          )}
          {isFailed && <p>{summarizeStepError(imageStep?.error)}</p>}
        </div>
      )}

      <div className={`candidate-grid ${isRunning ? "is-generating" : ""}`}>
        {grouped.length === 0 && (
          <div className={`candidate-empty ${isRunning ? "generating" : ""}`}>
            {isRunning ? (
              <>
                <span className="inline-spinner large" aria-hidden="true" />
                <strong>{phaseText}</strong>
                <p>{detailParts.length ? detailParts.join(" · ") : "模型生成通常需要等待，请保持当前页面打开。"}</p>
              </>
            ) : (
              "暂无候选图。点击上方按钮生成场景图。"
            )}
          </div>
        )}
        {grouped.map(({ artifact, meta, group, cell }: any) => {
          const isRegenerating = regeneratingImageId === artifact.id;
          const version = meta.regeneratedAt || artifact.metaSig || artifact.contentSig || "";
          const regeneratedTime = formatRegeneratedAt(meta.regeneratedAt);
          const imageUrl = artifact.path ? `${fileUrl(artifact.path)}?v=${version}` : "";
          const label = `候选图 ${group}-${cell}`;
          return (
            <figure className={`candidate-card ${isRegenerating ? "is-regenerating" : ""}`} key={artifact.id}>
              {imageUrl && (
                <button
                  type="button"
                  className="candidate-image-button"
                  onClick={() => setPreviewImage({ url: imageUrl, label, brief: meta.brief || artifact.label || "场景图候选", meta })}
                  aria-label={`放大查看${label}`}
                >
                  <img src={imageUrl} alt={meta.brief || artifact.label || "候选图"} />
                </button>
              )}
              <figcaption>
                <strong>{label}</strong>
                <p>{meta.segmentBinding ? `口播第 ${meta.segmentBinding} 段 · ` : ""}{meta.brief || artifact.label || "场景图候选"}</p>
                <div>
                  <span>{isRegenerating ? "重生成中" : regeneratedTime ? `重生成 ${regeneratedTime}` : "已生成"}</span>
                  <button disabled={busy || isRegenerating} onClick={() => regenerateImage(artifact.id)}>
                    {isRegenerating ? "重生成中..." : "重生成此图"}
                  </button>
                </div>
              </figcaption>
            </figure>
          );
        })}
      </div>
      {previewImage?.url && (
        <div className="candidate-lightbox" role="dialog" aria-modal="true" aria-label="候选图大图预览" onClick={() => setPreviewImage(null)}>
          <div className="candidate-lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <div className="candidate-lightbox-head">
              <strong>{previewImage.label || "候选图预览"}</strong>
              <button type="button" className="btn btn-ghost" onClick={() => setPreviewImage(null)}>关闭</button>
            </div>
            <div className="candidate-lightbox-stage">
              <img src={previewImage.url} alt={`${previewImage.label || "候选图"}大图预览`} />
            </div>
            <div className="candidate-lightbox-meta">
              <span>{previewImage.meta?.width && previewImage.meta?.height ? `${previewImage.meta.width}x${previewImage.meta.height}` : "完整预览"}</span>
              <p>{previewImage.brief || "场景图候选"}</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
