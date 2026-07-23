"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import IntakeForm from "./IntakeForm";

type TaskRow = {
  id: string;
  sourceUrl: string;
  title: string | null;
  author: string | null;
  bookTitle: string | null;
  bookAuthor: string | null;
  projectPath: string | null;
  currentGate: string;
  status: string;
  stats?: string | null;
  createdAt: number;
  updatedAt?: number;
};

const statusCopy: Record<string, { label: string; tone: string }> = {
  created: { label: "等待启动", tone: "idle" },
  running: { label: "正在分析", tone: "run" },
  waiting_confirmation: { label: "待确认图书", tone: "wait" },
  ready_for_weread: { label: "可查热门划线", tone: "ready" },
  failed: { label: "需要处理", tone: "error" },
};

function createdAt(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function parseStats(raw: string | null | undefined) {
  try { return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}

function compactNumber(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "—";
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}万`;
  return number.toLocaleString("zh-CN");
}

function durationLabel(value: unknown) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function gateLabel(task: TaskRow) {
  if (task.status === "ready_for_weread") return "G01 热门划线";
  if (task.status === "waiting_confirmation") return "确认书名作者";
  if (task.status === "failed") return "处理异常";
  return "抖音采集分析";
}

export default function IntakeHome({ tasks }: { tasks: TaskRow[] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [gateFilter, setGateFilter] = useState("all");
  const [sortBy, setSortBy] = useState("created");
  const waiting = tasks.filter((task) => task.status === "waiting_confirmation").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const ready = tasks.filter((task) => task.status === "ready_for_weread").length;
  const failed = tasks.filter((task) => task.status === "failed").length;

  const visibleTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks
      .filter((task) => {
        const haystack = `${task.title || ""} ${task.author || ""} ${task.bookTitle || ""} ${task.bookAuthor || ""} ${task.sourceUrl}`.toLowerCase();
        if (needle && !haystack.includes(needle)) return false;
        if (statusFilter !== "all" && task.status !== statusFilter) return false;
        if (gateFilter !== "all" && gateLabel(task) !== gateFilter) return false;
        return true;
      })
      .sort((left, right) => {
        if (sortBy === "likes") {
          return Number(parseStats(right.stats).likes || 0) - Number(parseStats(left.stats).likes || 0);
        }
        if (sortBy === "comments") {
          return Number(parseStats(right.stats).comments || 0) - Number(parseStats(left.stats).comments || 0);
        }
        return right.createdAt - left.createdAt;
      });
  }, [tasks, query, statusFilter, gateFilter, sortBy]);

  return (
    <main className="studio-shell">
      <header className="studio-topbar">
        <div>
          <span className="studio-breadcrumb">图书视频生产 / 抖音采集</span>
          <h1>热点采集到图书生产</h1>
          <p>从抖音参考链接提取口播与爆款结构，确认图书后进入微信读书热门划线。</p>
        </div>
        <div className="studio-top-actions">
          <Link href="/">刷新数据</Link>
          <Link href="/books">书籍库</Link>
          <span>第一版：采集与图书确认</span>
        </div>
      </header>

      <section className="studio-import-panel">
        <IntakeForm />
        <div className="studio-mode-summary">
          <span>处理方式</span>
          <strong>分析到书名确认</strong>
          <small>不会自动进入热门划线或改写</small>
        </div>
      </section>

      <section className="studio-results" aria-labelledby="task-list-title">
        <div className="studio-section-head">
          <div>
            <span className="studio-breadcrumb">采集结果</span>
            <h2 id="task-list-title">任务与确认门</h2>
            <p>按来源数据、图书识别结果和当前生产节点筛选。</p>
          </div>
          <div className="studio-summary-line" aria-label="任务概览">
            <span>运行中 <strong>{running}</strong></span>
            <span>待确认 <strong>{waiting}</strong></span>
            <span>可查划线 <strong>{ready}</strong></span>
            <span>异常 <strong>{failed}</strong></span>
          </div>
        </div>

        <div className="studio-filter-grid">
          <label className="studio-search-field">
            <span>关键词</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、账号、书名或作者" />
          </label>
          <label>
            <span>任务状态</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">全部状态</option>
              <option value="running">正在分析</option>
              <option value="waiting_confirmation">待确认图书</option>
              <option value="ready_for_weread">可查热门划线</option>
              <option value="failed">需要处理</option>
            </select>
          </label>
          <label>
            <span>当前节点</span>
            <select value={gateFilter} onChange={(event) => setGateFilter(event.target.value)}>
              <option value="all">全部节点</option>
              <option value="抖音采集分析">抖音采集分析</option>
              <option value="确认书名作者">确认书名作者</option>
              <option value="G01 热门划线">G01 热门划线</option>
              <option value="处理异常">处理异常</option>
            </select>
          </label>
          <label>
            <span>排序方式</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="created">最近创建</option>
              <option value="likes">点赞量</option>
              <option value="comments">评论量</option>
            </select>
          </label>
          <label>
            <span>来源平台</span>
            <select disabled defaultValue="douyin"><option value="douyin">抖音</option></select>
          </label>
          <label>
            <span>生产版本</span>
            <select disabled defaultValue="v1"><option value="v1">采集工作台 V1</option></select>
          </label>
          <div className="studio-filter-actions">
            <button type="button" onClick={() => {
              setQuery("");
              setStatusFilter("all");
              setGateFilter("all");
              setSortBy("created");
            }}>重置筛选</button>
          </div>
        </div>

        <nav className="studio-stage-tabs" aria-label="生产节点">
          <button className="active" type="button">全部任务 <span>{tasks.length}</span></button>
          <button type="button" onClick={() => setStatusFilter("waiting_confirmation")}>待确认图书 <span>{waiting}</span></button>
          <button type="button" onClick={() => setStatusFilter("ready_for_weread")}>待热门划线 <span>{ready}</span></button>
          <button type="button" disabled>待文案确认 <span>0</span></button>
          <button type="button" disabled>待风格样图 <span>0</span></button>
          <button type="button" disabled>后期制作 <span>0</span></button>
        </nav>

        <div className="studio-table-toolbar">
          <span>共 {visibleTasks.length} 条记录</span>
          <div>
            <button type="button" onClick={() => navigator.clipboard?.writeText(visibleTasks.map((task) => task.sourceUrl).join("\n"))}>复制当前链接</button>
            <span>正式产物保存到 work/</span>
          </div>
        </div>

        {visibleTasks.length === 0 ? (
          <div className="studio-empty">
            <strong>还没有采集任务</strong>
            <p>{tasks.length ? "当前筛选条件没有结果。" : "在上方粘贴第一条抖音链接，系统会创建项目目录并开始分析。"}</p>
          </div>
        ) : (
          <div className="studio-table-wrap">
            <table className="studio-task-table">
              <thead>
                <tr>
                  <th>序号</th>
                  <th>来源</th>
                  <th>抖音标题</th>
                  <th>识别图书</th>
                  <th>账号</th>
                  <th>点赞</th>
                  <th>评论</th>
                  <th>分享</th>
                  <th>时长</th>
                  <th>创建时间</th>
                  <th>当前确认门</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.map((task, index) => {
                  const status = statusCopy[task.status] || statusCopy.created;
                  const stats = parseStats(task.stats);
                  return (
                    <tr key={task.id}>
                      <td className="studio-number">{visibleTasks.length - index}</td>
                      <td><span className="studio-source-badge">抖音</span></td>
                      <td className="studio-title-cell">
                        <Link href={`/tasks/${task.id}`}>{task.title || "正在读取抖音信息"}</Link>
                        <small>{task.sourceUrl}</small>
                      </td>
                      <td>
                        <strong>{task.bookTitle ? `《${task.bookTitle}》` : "待识别"}</strong>
                        <small>{task.bookAuthor || "作者待确认"}</small>
                      </td>
                      <td>{task.author || "—"}</td>
                      <td className="studio-number">{compactNumber(stats.likes)}</td>
                      <td className="studio-number">{compactNumber(stats.comments)}</td>
                      <td className="studio-number">{compactNumber(stats.shares)}</td>
                      <td>{durationLabel(stats.duration)}</td>
                      <td>{createdAt(task.createdAt)}</td>
                      <td><span className="studio-gate-badge">{gateLabel(task)}</span></td>
                      <td><span className={`intake-status ${status.tone}`}>{status.label}</span></td>
                      <td className="studio-row-actions">
                        <Link href={`/tasks/${task.id}`}>详情</Link>
                        <a href={task.sourceUrl} target="_blank" rel="noreferrer">原链</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
