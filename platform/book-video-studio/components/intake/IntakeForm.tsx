"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTasksAction, type CreateTasksResult } from "@/app/actions";

export default function IntakeForm() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<CreateTasksResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (!input.trim()) return;
    startTransition(async () => {
      const next = await createTasksAction(input.trim(), "intake");
      setResult(next);
      if (next.created.length === 1 && next.duplicates.length === 0) {
        router.push(`/tasks/${next.created[0]}`);
        return;
      }
      if (next.created.length) setInput("");
      router.refresh();
    });
  };

  return (
    <section className="intake-entry" aria-labelledby="intake-title">
      <div className="intake-entry-copy">
        <span className="intake-kicker">第一步</span>
        <h2 id="intake-title">发送抖音链接</h2>
        <p>自动下载参考视频、提取口播、识别书名作者并拆解爆款结构。分析完成后会停下来等你确认。</p>
      </div>
      <div className="intake-entry-form">
        <label htmlFor="douyin-links">抖音分享链接或完整分享文本</label>
        <textarea
          id="douyin-links"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit();
          }}
          placeholder="例如：https://v.douyin.com/xxxx/&#10;支持多条链接，每行一条"
          rows={4}
        />
        <div className="intake-entry-actions">
          <span>Ctrl / ⌘ + Enter 快速提交</span>
          <button type="button" disabled={pending || !input.trim()} onClick={submit}>
            {pending ? "正在创建…" : "开始分析"}
          </button>
        </div>
        {result?.duplicates.length ? (
          <div className="intake-inline-note" role="status">
            已跳过 {result.duplicates.length} 条重复链接。
            {result.duplicates[0]?.existing.id ? (
              <a href={`/tasks/${result.duplicates[0].existing.id}`}>打开已有任务</a>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
