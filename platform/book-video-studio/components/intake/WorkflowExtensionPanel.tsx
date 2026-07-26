"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  taskId: string;
  data: any;
  reload: () => Promise<void>;
  onRollback?: (target: "delivery_review" | "publication") => Promise<void>;
};

const NODE_LABELS: Record<string, string> = {
  topic_discovery: "G00 主动选题",
  text_compliance: "C01 文案合规初审",
  voice_timeline: "V01 提前配音与真实时间轴",
  media_compliance: "C02 发布前完整审核",
  draft_upload: "G07 视频号草稿箱",
  publication: "G08 人工发布确认",
  analytics: "G09 发布数据复盘",
};

const METRIC_FIELDS = [
  ["plays", "播放量"], ["uniqueViewers", "独立观众"], ["averageWatchSeconds", "平均观看秒数"],
  ["completionRate", "完播率（0-1）"], ["likes", "点赞"], ["comments", "评论"],
  ["shares", "分享"], ["favorites", "收藏"], ["newFollowers", "新增关注"],
  ["productClicks", "商品点击"], ["orders", "订单"], ["gmv", "GMV"], ["commission", "佣金"],
] as const;

export default function WorkflowExtensionPanel({ taskId, data, reload, onRollback }: Props) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [publication, setPublication] = useState({ platformWorkId: "", url: "", publishedAt: "" });
  const [horizon, setHorizon] = useState("24h");
  const [metrics, setMetrics] = useState<Record<string, string>>({});
  const runs = data.workflowRuns || [];
  const records = data.publicationRecords || [];
  const snapshots = data.metricSnapshots || [];
  const status = String(data.task?.status || "");

  useEffect(() => {
    fetch("/api/publication/accounts")
      .then((response) => response.json())
      .then((payload) => {
        setAccounts(payload.accounts || []);
        if (payload.accounts?.[0]) setAccountId(payload.accounts[0].id);
      })
      .catch(() => {});
  }, []);

  const latestRecord = useMemo(
    () => [...records].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))[0],
    [records],
  );

  async function post(url: string, body: any) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || response.statusText);
      setMessage(payload.message || "操作已提交");
      await reload();
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workflow-extension">
      <div className="workflow-extension-heading">
        <div>
          <span>Codex 全流程联动</span>
          <h2>C01 / V01 / C02 / G07–G09</h2>
        </div>
        <small>{data.task?.codexThreadId ? `Codex 主任务：${data.task.codexThreadId}` : "Codex 主任务将在首个后台节点启动"}</small>
      </div>

      <div className="workflow-run-grid">
        {Object.entries(NODE_LABELS).map(([key, label]) => {
          const run = runs.find((item: any) => item.nodeKey === key);
          return (
            <article key={key}>
              <strong>{label}</strong>
              <span>{run?.status || "pending"}</span>
              <div><i style={{ width: `${Math.round(Number(run?.progress || 0) * 100)}%` }} /></div>
              <p>{run?.message || "等待上游节点"}</p>
              {run?.error ? <small className="workflow-error">{run.error}</small> : null}
            </article>
          );
        })}
      </div>

      {["text_compliance_failed", "text_compliance_blocked"].includes(status) ? (
        <button disabled={busy} onClick={() => post(`/api/tasks/${taskId}/compliance`, { scope: "text" })}>
          重新执行 C01 文案合规初审
        </button>
      ) : null}
      {["media_compliance_failed", "media_compliance_blocked"].includes(status) ? (
        <button disabled={busy} onClick={() => post(`/api/tasks/${taskId}/compliance`, { scope: "media" })}>
          重新执行 C02 发布前完整审核
        </button>
      ) : null}
      {runs.find((item: any) => item.nodeKey === "voice_timeline")?.status === "failed" ? (
        <button disabled={busy} onClick={() => post(`/api/tasks/${taskId}/voice-timeline`, {})}>
          重新执行 V01 提前配音
        </button>
      ) : null}

      {["ready_for_draft_upload", "draft_upload_failed", "done"].includes(status) ? (
        <div className="workflow-action-card">
          <h3>G07 自动上传视频号草稿箱</h3>
          <p>这里只会点击“保存草稿”，不会点击正式发表。</p>
          <button disabled={busy} onClick={() => onRollback?.("delivery_review")}>返回自动交付结果</button>
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">选择已登录视频号账号</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
          </select>
          {!accounts.length ? <small>请先把账号 cookie 放入 F:\Codex\data\book-video-studio\weixin-accounts。</small> : null}
          <button disabled={busy || !accountId} onClick={() => post(`/api/tasks/${taskId}/draft-upload`, { accountId })}>
            上传到所选账号草稿箱
          </button>
        </div>
      ) : null}

      {status === "waiting_publication_confirmation" || latestRecord?.status === "published" ? (
        <div className="workflow-action-card">
          <h3>G08 人工发布确认</h3>
          <p>草稿：{latestRecord?.draftId || "—"} · 账号：{latestRecord?.accountId || "—"}</p>
          <button disabled={busy} onClick={() => onRollback?.("delivery_review")}>返回自动交付结果</button>
          <input placeholder="视频号作品 ID（必填）" value={publication.platformWorkId} onChange={(event) => setPublication({ ...publication, platformWorkId: event.target.value })} />
          <input placeholder="作品链接（可选）" value={publication.url} onChange={(event) => setPublication({ ...publication, url: event.target.value })} />
          <input type="datetime-local" value={publication.publishedAt} onChange={(event) => setPublication({ ...publication, publishedAt: event.target.value })} />
          <button disabled={busy || !publication.platformWorkId} onClick={() => post(`/api/tasks/${taskId}/publication`, {
            ...publication,
            accountId: latestRecord?.accountId,
            publishedAt: publication.publishedAt ? new Date(publication.publishedAt).getTime() : Date.now(),
          })}>确认已经人工发布</button>
        </div>
      ) : null}

      {latestRecord?.status === "published" && status !== "waiting_publication_confirmation" ? (
        <div className="workflow-action-card">
          <h3>G09 发布数据复盘</h3>
          <button disabled={busy} onClick={() => onRollback?.("publication")}>返回修改 G08 发布信息</button>
          <div className="workflow-horizons">
            {["24h", "72h", "7d"].map((item) => (
              <button key={item} className={horizon === item ? "active" : ""} onClick={() => setHorizon(item)}>
                {item}{snapshots.some((snapshot: any) => snapshot.horizon === item) ? " ✓" : ""}
              </button>
            ))}
          </div>
          <div className="workflow-metric-grid">
            {METRIC_FIELDS.map(([key, label]) => (
              <label key={key}><span>{label}</span><input type="number" min="0" step="any" value={metrics[key] || ""} onChange={(event) => setMetrics({ ...metrics, [key]: event.target.value })} /></label>
            ))}
          </div>
          <button disabled={busy} onClick={() => post(`/api/tasks/${taskId}/metrics`, { horizon, metrics })}>
            保存 {horizon} 数据并生成复盘
          </button>
          {snapshots.map((snapshot: any) => <p key={snapshot.id}><strong>{snapshot.horizon}：</strong>{snapshot.review}</p>)}
        </div>
      ) : null}
      {message ? <div className="workflow-message">{message}</div> : null}
    </section>
  );
}
