"use client";

import { useRef, useState } from "react";
import { fileUrl, fmtDuration, Metric, parseJson, summarizeStepError } from "./shared";

const TTS_PHASE_COPY: Record<string, string> = {
  "preparing-segments": "正在准备口播分段",
  "segments-ready": "口播分段已准备",
  synthesizing: "正在合成分段音频",
  "segment-saved": "分段音频已保存",
  merging: "正在合并完整音频",
  "saving-artifact": "正在写入音频产物",
  done: "音频生成完成",
};

function percent(progress: unknown) {
  const n = Number(progress || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100)));
}

export default function AudioWorkspace({ scriptText, ttsArt, ttsMeta, ttsStep, rewriteSegmentsMeta, config, setConfig, renderCount, busy, canRun, act, saveTaskConfig, runCompanionImages }: any) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewStatus, setPreviewStatus] = useState("");
  const rewriteSegments = Array.isArray(rewriteSegmentsMeta.segments) ? rewriteSegmentsMeta.segments : [];
  const segments = Array.isArray(ttsMeta.segments) ? ttsMeta.segments : rewriteSegments.length ? rewriteSegments : estimateSegments(scriptText);
  const progressMeta = parseJson(ttsStep?.output);
  const totalDur = Number(ttsMeta.totalDur || 0) || segments.reduce((sum: number, s: any) => sum + Number(s.dur || s.estimatedDur || 0), 0);
  const charCount = scriptText.replace(/\s/g, "").length;
  const ttsStatus = ttsStep?.status || "pending";
  const isRunning = ttsStatus === "running";
  const isFailed = ttsStatus === "failed";
  const status = ttsArt?.path ? "已生成" : isRunning ? "生成中" : isFailed ? "生成失败" : "待生成";
  const progressPct = percent(ttsStep?.progress);
  const phaseText = isFailed ? "音频生成失败" : TTS_PHASE_COPY[String(progressMeta.phase || "")] || (isRunning ? "音频生成中" : "等待生成");
  const ttsJob = progressMeta.ttsJob || {};
  const completedSegments = Number(progressMeta.completedSegments || 0);
  const totalSegments = Number(progressMeta.totalSegments || progressMeta.segs || segments.length || 0);
  const estimatedPerVideo = totalDur ? `${fmtDuration(totalDur)} / 条` : "待估算";
  const progressParts = [
    progressMeta.provider ? `通道 ${progressMeta.provider}` : ttsMeta.provider ? `通道 ${ttsMeta.provider}` : "",
    progressMeta.voice || ttsMeta.voice || config.voice ? `音色 ${progressMeta.voice || ttsMeta.voice || config.voice}` : "",
    totalSegments ? `已完成 ${completedSegments}/${totalSegments} 段` : "",
    ttsJob.jobId ? `任务 ${String(ttsJob.jobId).slice(0, 8)}` : "",
    ttsJob.jobStatus ? `worker ${ttsJob.jobStatus}` : "",
    Number.isFinite(Number(ttsJob.queuePosition)) && Number(ttsJob.queuePosition) > 0 ? `排队第 ${ttsJob.queuePosition}` : "",
    Number.isFinite(Number(ttsJob.jobProgress)) ? `worker ${percent(ttsJob.jobProgress)}%` : "",
    Number.isFinite(Number(ttsJob.elapsedSeconds)) ? `已用 ${fmtDuration(ttsJob.elapsedSeconds)}` : "",
    progressMeta.lastDuration ? `上一段 ${fmtDuration(progressMeta.lastDuration)}` : "",
    progressMeta.accumulatedDuration ? `累计 ${fmtDuration(progressMeta.accumulatedDuration)}` : "",
  ].filter(Boolean);
  const generateAudio = async () => {
    if (!(await saveTaskConfig("tts", config, "保存音频配置"))) return;
    const started = await act(ttsArt?.path ? "rerun" : "run", "tts");
    if (!started) return;
    await runCompanionImages?.();
  };
  const previewAudio = async () => {
    if (!ttsArt?.path) {
      setPreviewStatus("暂无可预览音频，请先生成音频。");
      return;
    }
    const player = audioRef.current;
    if (!player) {
      setPreviewStatus("播放器暂未就绪，请稍后重试。");
      return;
    }
    player.scrollIntoView({ behavior: "smooth", block: "center" });
    player.focus({ preventScroll: true });
    try {
      await player.play();
      setPreviewStatus("正在播放预览音频。");
    } catch {
      setPreviewStatus("已定位到播放器，请在播放器上手动播放。");
    }
  };

  return (
    <section className="audio-workspace">
      <div className="audio-head">
        <div>
          <div className="section-kicker">AUDIO</div>
          <h2>音频生成与时长预估</h2>
        </div>
        <button
          className="btn btn-ghost"
          disabled={!ttsArt?.path}
          onClick={previewAudio}
          title={ttsArt?.path ? "滚动到音频播放器并播放" : "暂无音频，请先生成音频"}
        >
          {ttsArt?.path ? "预览音频" : "暂无音频可预览"}
        </button>
      </div>

      <div className="audio-metrics">
        <Metric label="文案字数" value={`${charCount || 0} 字`} />
        <Metric label="预估口播" value={totalDur ? fmtDuration(totalDur) : "待估算"} />
        <Metric label="音频状态" value={status} />
        <Metric label="成片预估" value={`${Math.max(renderCount, 1)} 条 · ${estimatedPerVideo}`} />
      </div>

      {(isRunning || isFailed) && (
        <div className={`image-progress-panel audio-progress-panel ${isFailed ? "failed" : ""}`}>
          <div className="image-progress-head">
            <div>
              <strong>{phaseText}</strong>
              <span>{progressParts.length ? progressParts.join(" · ") : "等待后台返回分段进度"}</span>
            </div>
            <em>{progressPct}%</em>
          </div>
          <div className="image-progress-track" aria-label="音频生成进度">
            <span style={{ width: `${progressPct}%` }} />
          </div>
          {progressMeta.textPreview && !isFailed && (
            <p>当前片段：{progressMeta.textPreview}</p>
          )}
          {ttsJob.message && !isFailed && (
            <p>{ttsJob.message}</p>
          )}
          {isFailed && <p>{summarizeStepError(ttsStep?.error)}</p>}
        </div>
      )}

      <div className="audio-grid">
        <div className="audio-config-card">
          <div className="audio-card-head">
            <h3>生成配置</h3>
            <span>音色、语速和参考音频</span>
          </div>
          <div className="audio-form-grid">
            <label>
              <span>音色</span>
              <select
                className="field dashboard-select"
                value={config.voice}
                onChange={(e) => setConfig((prev: any) => ({ ...prev, voice: e.target.value }))}
              >
                <option value="default">自用</option>
                <option value="常用">常用（默认）</option>
                <option value="女声自用">女声自用</option>
              </select>
            </label>
            <label>
              <span>语速预估</span>
              <select
                className="field dashboard-select"
                value={config.speed}
                onChange={(e) => setConfig((prev: any) => ({ ...prev, speed: e.target.value }))}
              >
                <option value="0.9">0.90x 慢速</option>
                <option value="1">1.00x 标准</option>
                <option value="1.1">1.10x 默认</option>
              </select>
            </label>
          </div>
          <div className="voice-ready">
            <strong>已配置音色</strong>
            <span>{ttsMeta.provider ? `当前通道：${ttsMeta.provider} · 音色 ${ttsMeta.voice || config.voice} · 语速 ${ttsMeta.speed || config.speed}x` : "生成前会保存音色与语速配置"}</span>
          </div>
          <button className="btn btn-ok audio-generate" disabled={busy || !canRun} onClick={generateAudio}>
            {ttsArt?.path ? "重新生成音频" : "生成音频"}
          </button>
          <div className="audio-preview">
            <div>
              <strong>音频预览</strong>
              <span aria-live="polite">{previewStatus || (ttsArt?.path ? "生成完成后自动更新" : "生成后可在这里播放")}</span>
            </div>
            {ttsArt?.path ? (
              <audio ref={audioRef} controls src={fileUrl(ttsArt.path)} tabIndex={-1} />
            ) : (
              <div className="audio-placeholder">
                <span>▶</span>
                <em>0:00 / {totalDur ? fmtDuration(totalDur) : "0:00"}</em>
                <b />
              </div>
            )}
          </div>
        </div>

        <div className="segment-card">
          <div className="audio-card-head">
            <h3>分段时长预估</h3>
            <span>按当前最终文案自动估算</span>
          </div>
          <div className="segment-list">
            {segments.length === 0 && <div className="segment-empty">暂无文案分段。确认清洗和候选稿后会在这里显示。</div>}
            {segments.map((seg: any, index: number) => (
              <div className="segment-row" key={index}>
                <strong>音频片段 {index + 1}</strong>
                <span>{fmtDuration(seg.dur || seg.estimatedDur || Math.max(6, (seg.text || "").length / 4.5))}</span>
                <p>{seg.text || "等待分段文本..."}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function estimateSegments(text: string) {
  return text
    .split(/(?<=[。！？!?])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((text, idx) => ({ idx, text, dur: Math.max(6, text.replace(/\s/g, "").length / 4.5) }));
}
