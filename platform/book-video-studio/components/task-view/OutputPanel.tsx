"use client";

import { fileUrl } from "./shared";

export function TextPanel({ title, badge, artifact, editing, setEditing, saveArtifact, busy, tone }: any) {
  const content = artifact?.content || "";
  const editable = artifact?.id && content && (artifact.kind === "rewrite" || artifact.kind === "cleaned" || artifact.kind === "transcript");
  const isEditing = artifact?.id && artifact.id in editing;
  return (
    <div className="text-panel">
      <div className="text-panel-head">
        <strong>{title}</strong>
        <span className={tone === "ok" ? "panel-badge ok" : "panel-badge"}>{badge}</span>
      </div>
      {isEditing ? (
        <>
          <textarea
            className="field edit-area"
            value={editing[artifact.id]}
            onChange={(e) => setEditing((prev: any) => ({ ...prev, [artifact.id]: e.target.value }))}
          />
          <div className="edit-actions">
            <button className="btn btn-ok" disabled={busy} onClick={() => saveArtifact(artifact.id, editing[artifact.id])}>保存</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setEditing((prev: any) => { const n = { ...prev }; delete n[artifact.id]; return n; })}>取消</button>
          </div>
        </>
      ) : (
        <div className="text-scroll">{content || "暂无内容。运行上游步骤后会在这里显示。"}</div>
      )}
      {editable && !isEditing && (
        <button className="panel-edit" disabled={busy} onClick={() => setEditing((prev: any) => ({ ...prev, [artifact.id]: content }))}>编辑文本</button>
      )}
    </div>
  );
}

export default function OutputPanel({ title, step, artifacts, editing, setEditing, saveArtifact, busy }: any) {
  return (
    <div id={step === "rewrite" ? "rewrite" : undefined} className="output-panel">
      <h3>{title}</h3>
      {artifacts.length === 0 ? (
        <p className="muted">暂无产物。</p>
      ) : (
        <div className="artifact-list">
          {artifacts.map((a: any) => (
            <ArtifactItem
              key={a.id}
              artifact={a}
              editing={editing}
              setEditing={setEditing}
              saveArtifact={saveArtifact}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactItem({ artifact: a, editing, setEditing, saveArtifact, busy }: any) {
  const editable = a.content && (a.kind === "rewrite" || a.kind === "cleaned" || a.kind === "transcript");
  const isEditing = a.id in editing;
  const pathUrl = a.path ? fileUrl(a.path) : "";
  let meta: any = {};
  try { meta = JSON.parse(a.meta || "{}"); } catch { meta = {}; }
  const brief = meta.brief || "";

  if (a.kind === "image" && a.path) {
    return (
      <figure className="scene-thumb">
        <img src={fileUrl(a.path)} alt={brief || a.label || "场景图"} />
        <figcaption>{brief || a.label}</figcaption>
      </figure>
    );
  }

  return (
    <div className="artifact-item">
      <div className="artifact-head">
        <strong>{a.label || a.kind}</strong>
        {editable && !isEditing && (
          <button disabled={busy} onClick={() => setEditing((prev: any) => ({ ...prev, [a.id]: a.content }))}>编辑</button>
        )}
      </div>

      {a.content && !isEditing && <div className="artifact-text">{a.content}</div>}
      {isEditing && (
        <>
          <textarea
            className="field edit-area"
            value={editing[a.id]}
            onChange={(e) => setEditing((prev: any) => ({ ...prev, [a.id]: e.target.value }))}
          />
          <div className="edit-actions">
            <button className="btn btn-ok" disabled={busy} onClick={() => saveArtifact(a.id, editing[a.id])}>保存</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setEditing((prev: any) => { const n = { ...prev }; delete n[a.id]; return n; })}>取消</button>
          </div>
        </>
      )}

      {a.path && a.kind === "audio" && <audio controls src={pathUrl} />}
      {a.path && a.kind === "video" && (
        <div className="video-output">
          <div className="video-output-meta">
            <span>{meta.styleLabel || meta.style || "模板"}</span>
            <span>{meta.motionLabel || meta.motion || "动效"}</span>
            <span>{meta.engine || "engine"}</span>
            {meta.videoCover && <span>首页图</span>}
            {meta.durationSec && <span>{Math.round(meta.durationSec)}s</span>}
          </div>
          <video controls playsInline preload="metadata" src={pathUrl} />
          <div className="video-output-actions">
            <a className="btn btn-ok" href={pathUrl} target="_blank" rel="noreferrer">预览视频</a>
            <a className="btn btn-ghost" href={pathUrl} target="_blank" rel="noreferrer">打开原文件</a>
            <a className="btn btn-primary" href={pathUrl} download>下载成片</a>
          </div>
        </div>
      )}
      {!a.content && !a.path && a.meta && <pre>{a.meta}</pre>}
    </div>
  );
}
