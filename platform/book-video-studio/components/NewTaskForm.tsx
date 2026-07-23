"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTasksAction, type CreateTasksResult, type ImportMode } from "@/app/actions";

const AUTO_TRANSCRIBE_KEY = "book-video-studio:auto-transcribe";

function getAutoTranscribePreference() {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(AUTO_TRANSCRIBE_KEY);
  return stored === null ? true : stored === "true";
}

export default function NewTaskForm() {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<ImportMode>("pipeline");
  const [autoTranscribe, setAutoTranscribe] = useState(true);
  const [importResult, setImportResult] = useState<CreateTasksResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    setAutoTranscribe(getAutoTranscribePreference());
    const onPreferenceChange = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      setAutoTranscribe(typeof detail === "boolean" ? detail : getAutoTranscribePreference());
    };
    window.addEventListener("book-video:auto-transcribe-change", onPreferenceChange);
    window.addEventListener("storage", onPreferenceChange);
    return () => {
      window.removeEventListener("book-video:auto-transcribe-change", onPreferenceChange);
      window.removeEventListener("storage", onPreferenceChange);
    };
  }, []);

  const submit = () => {
    if (!url.trim()) return;
    start(async () => {
      const preference = getAutoTranscribePreference();
      setAutoTranscribe(preference);
      const result = await createTasksAction(url.trim(), mode, { autoTranscribe: preference });
      setImportResult(result);
      if (result.duplicates.length === 0) setUrl("");
      if (result.created.length === 1 && result.duplicates.length === 0) router.push(`/tasks/${result.created[0]}`);
      else router.refresh();
    });
  };
  return (
    <>
      <div className="url-import-grid">
        <label className="import-field">
          <span>分享 URL</span>
          <textarea
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder="支持单条或多条，换行粘贴；也支持直接粘贴抖音/视频号分享文本"
            className="field dashboard-input"
            rows={1}
          />
        </label>
        <label className="import-mode">
          <span>处理方式</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ImportMode)}
            className="field dashboard-select"
          >
            <option value="pipeline">全自动（直到成片）</option>
            <option value="collect">采集后自动改写</option>
            <option value="draft">采集后停在改写</option>
            <option value="manual">只创建记录</option>
          </select>
          {!autoTranscribe && mode !== "manual" && (
            <small className="import-hint">已关闭自动逐字稿，本次会先停在素材采集。</small>
          )}
        </label>
        <div className="import-actions">
          <button className="btn btn-primary import-submit" disabled={pending || !url.trim()} onClick={submit}>
            {pending ? "创建中…" : "按 URL 导入"}
          </button>
        </div>
      </div>

      {importResult && (importResult.created.length > 0 || importResult.duplicates.length > 0) && (
        <div className={`import-result ${importResult.duplicates.length ? "has-duplicates" : ""}`} role="status">
          {importResult.created.length > 0 && (
            <p>已新建 {importResult.created.length} 条采集任务。</p>
          )}
          {importResult.duplicates.length > 0 && (
            <>
              <strong>已拦截 {importResult.duplicates.length} 条重复采集</strong>
              <div className="duplicate-list">
                {importResult.duplicates.slice(0, 5).map((item, index) => {
                  const title = item.existing.bookTitle || item.existing.title || item.existing.sourceUrl;
                  return (
                    <div className="duplicate-item" key={`${item.duplicateKey}-${index}`}>
                      <span>{title}</span>
                      <a href={`/tasks/${item.existing.id}`}>打开旧任务</a>
                    </div>
                  );
                })}
              </div>
              {importResult.duplicates.length > 5 && <em>还有 {importResult.duplicates.length - 5} 条重复链接已跳过。</em>}
            </>
          )}
        </div>
      )}
    </>
  );
}
