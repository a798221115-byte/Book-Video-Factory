"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ToastHost, { useToasts } from "./task-view/ToastHost";
import { copyTextToClipboard } from "./task-view/clipboard";

const AUTO_TRANSCRIBE_KEY = "book-video-studio:auto-transcribe";

type TaskRow = {
  id: string;
  sourceUrl: string;
  title: string | null;
  author: string | null;
  bookTitle: string | null;
  bookAuthor: string | null;
  notes: string | null;
  stats: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
};

function parseStats(raw: string | null) {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, number>; }
  catch { return {}; }
}

function n(value: unknown) {
  const num = typeof value === "number" ? value : Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return "0";
  return num.toLocaleString("zh-CN");
}

function shortDate(ts: number | null | undefined) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hour12: false,
  }).replace(/\//g, "-");
}

function sourceText(t: TaskRow) {
  if (/douyin|iesdouyin|抖音/i.test(t.sourceUrl)) return "URL导入";
  return "手动逐字稿";
}

function statusLabel(status: string) {
  const map: Record<string, { text: string; tone: string }> = {
    created: { text: "待成片确认", tone: "idle" },
    running: { text: "任务进行中", tone: "run" },
    done: { text: "待改写确认", tone: "ok" },
    failed: { text: "异常", tone: "warn" },
  };
  return map[status] || map.created;
}

function titleOf(t: TaskRow) {
  return t.title || t.bookTitle || t.sourceUrl;
}

async function writeClipboard(text: string) {
  await copyTextToClipboard(text);
}

export default function CollectorTable({ tasks }: { tasks: TaskRow[] }) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [autoTranscribe, setAutoTranscribe] = useState(true);
  const [editingNotes, setEditingNotes] = useState<Record<string, string | null>>({});
  const [pending, startTransition] = useTransition();
  const { toasts, notify, dismissToast } = useToasts();
  const router = useRouter();

  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);
  const allChecked = tasks.length > 0 && selectedIds.length === tasks.length;
  const selectedTasks = tasks.filter((t) => selected[t.id]);

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? Object.fromEntries(tasks.map((t) => [t.id, true])) : {});
  };

  useEffect(() => {
    const stored = window.localStorage.getItem(AUTO_TRANSCRIBE_KEY);
    if (stored !== null) setAutoTranscribe(stored === "true");
  }, []);

  const setAutoTranscribePreference = (checked: boolean) => {
    setAutoTranscribe(checked);
    window.localStorage.setItem(AUTO_TRANSCRIBE_KEY, String(checked));
    window.dispatchEvent(new CustomEvent("book-video:auto-transcribe-change", { detail: checked }));
  };

  const deleteIds = (ids: string[]) => {
    if (!ids.length) return;
    if (!confirm(`确认删除 ${ids.length} 条采集记录？任务文件也会一并清理。`)) return;
    startTransition(async () => {
      await fetch("/api/tasks/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      setSelected({});
      router.refresh();
    });
  };

  const bulkAction = (action: string, step?: string) => {
    if (!selectedIds.length) return;
    startTransition(async () => {
      try {
        const res = await fetch("/api/tasks/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: selectedIds, action, step }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `${res.status} ${res.statusText}`);
        notify({
          tone: "success",
          title: action === "stop" ? "已提交停止" : "已加入批量队列",
          detail: action === "stop" ? `处理 ${payload.stopped || 0} 个运行步骤` : `共 ${payload.queued || selectedIds.length} 个任务，并发 1 顺序执行`,
        });
        router.refresh();
      } catch (error: any) {
        notify({ tone: "error", title: "批量操作失败", detail: String(error?.message || error) });
      }
    });
  };

  const saveNotes = (id: string) => {
    const notes = editingNotes[id] ?? "";
    startTransition(async () => {
      try {
        const res = await fetch(`/api/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes }),
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          notify({
            tone: "error",
            title: "备注保存失败",
            detail: detail.error || `${res.status} ${res.statusText}`,
          });
          return;
        }
      } catch (e: any) {
        notify({
          tone: "error",
          title: "备注保存失败",
          detail: String(e?.message || e),
        });
        return;
      }
      setEditingNotes((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      notify({ tone: "success", title: "备注已保存" });
      router.refresh();
    });
  };

  return (
    <>
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
      <div className="results-tools">
        <label className="inline-check">
          <input type="checkbox" checked={autoTranscribe} onChange={(e) => setAutoTranscribePreference(e.target.checked)} />
          <span>自动生成逐字稿</span>
        </label>
        <button className="mini-action" disabled={!selectedTasks.length} onClick={() => writeClipboard(selectedTasks.map((t) => t.sourceUrl).join("\n"))}>复制勾选链接</button>
        <button className="mini-action" disabled={!tasks.length} onClick={() => writeClipboard(tasks.map((t) => t.sourceUrl).join("\n"))}>复制当前页链接</button>
        <button className="mini-action" disabled={pending || !selectedIds.length} onClick={() => bulkAction("pipeline")}>批量全链</button>
        <button className="mini-action" disabled={pending || !selectedIds.length} onClick={() => bulkAction("run", "rewrite")}>批量改写</button>
        <button className="mini-action" disabled={pending || !selectedIds.length} onClick={() => bulkAction("run", "tts")}>批量音频</button>
        <button className="mini-action" disabled={pending || !selectedIds.length} onClick={() => bulkAction("run", "images")}>批量图片</button>
        <button className="mini-action" disabled={pending || !selectedIds.length} onClick={() => bulkAction("run", "render")}>批量视频</button>
        <button className="mini-action" disabled={pending || !selectedIds.length} onClick={() => bulkAction("retry-failed")}>重试异常</button>
        <button className="mini-action" disabled={pending || !selectedIds.length} onClick={() => bulkAction("stop")}>停止勾选</button>
        <button className="mini-action" disabled={pending || !selectedIds.length} onClick={() => deleteIds(selectedIds)}>删除勾选记录</button>
      </div>

      <div className="table-wrap">
        <table className="collector-table">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="全选" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} /></th>
              <th>序号</th>
              <th>关键词</th>
              <th>标题</th>
              <th>描述</th>
              <th>作者</th>
              <th>粉丝</th>
              <th>时长</th>
              <th>发布</th>
              <th>采集</th>
              <th>点赞</th>
              <th>评论</th>
              <th>分享</th>
              <th>任务</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr>
                <td colSpan={15} className="empty-cell">暂无采集记录，先在上方粘贴抖音或视频号分享链接。</td>
              </tr>
            )}
            {tasks.map((t, index) => {
              const stats = parseStats(t.stats);
              const status = statusLabel(t.status);
              const title = titleOf(t);
              const isEditingNotes = editingNotes[t.id] !== undefined;
              return (
                <tr key={t.id}>
                  <td><input type="checkbox" aria-label={`选择 ${index + 1}`} checked={!!selected[t.id]} onChange={(e) => setSelected((prev) => ({ ...prev, [t.id]: e.target.checked }))} /></td>
                  <td className="num">{tasks.length - index}</td>
                  <td><span className="source-badge">{sourceText(t)}</span></td>
                  <td className="title-cell">
                    <Link href={`/tasks/${t.id}`}>{title.slice(0, 42)}{title.length > 42 ? "..." : ""}</Link>
                  </td>
                  <td className="desc-cell">{t.bookTitle ? `《${t.bookTitle}》${t.bookAuthor ? ` / ${t.bookAuthor}` : ""}` : t.sourceUrl}</td>
                  <td>{t.author || "-"}</td>
                  <td className="num">{n(stats.followers)}</td>
                  <td>{stats.duration ? `${Math.floor(Number(stats.duration) / 60)}:${String(Number(stats.duration) % 60).padStart(2, "0")}` : "-"}</td>
                  <td>{shortDate(Number(stats.publishedAt || t.updatedAt))}</td>
                  <td>{shortDate(t.createdAt)}</td>
                  <td className="num">{n(stats.likes)}</td>
                  <td className="num">{n(stats.comments)}</td>
                  <td className="num">{n(stats.shares)}</td>
                  <td>
                    <div className="status-stack">
                      <span className={`task-status ${status.tone}`}>{status.text}</span>
                      {isEditingNotes ? (
                        <span className="note-editor">
                          <input
                            aria-label="任务备注"
                            value={editingNotes[t.id] ?? ""}
                            onChange={(e) => setEditingNotes((prev) => ({ ...prev, [t.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveNotes(t.id);
                              if (e.key === "Escape") setEditingNotes((prev) => {
                                const next = { ...prev };
                                delete next[t.id];
                                return next;
                              });
                            }}
                            maxLength={200}
                            autoFocus
                          />
                          <button disabled={pending} onClick={() => saveNotes(t.id)}>保存</button>
                          <button
                            disabled={pending}
                            onClick={() => setEditingNotes((prev) => {
                              const next = { ...prev };
                              delete next[t.id];
                              return next;
                            })}
                          >
                            取消
                          </button>
                        </span>
                      ) : (
                        <button className="note-pill" onClick={() => setEditingNotes((prev) => ({ ...prev, [t.id]: t.notes || "" }))}>
                          {t.notes || "加备注"}
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button onClick={() => writeClipboard(t.sourceUrl)}>复制</button>
                      <a href={t.sourceUrl} target="_blank" rel="noreferrer">原链</a>
                      <Link href={`/tasks/${t.id}#rewrite`}>改写</Link>
                      <Link href={`/tasks/${t.id}`}>详情</Link>
                      <button disabled={pending} onClick={() => deleteIds([t.id])}>删除</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
