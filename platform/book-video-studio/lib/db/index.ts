import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "./data";
fs.mkdirSync(DATA_DIR, { recursive: true });
const dbPath = path.join(DATA_DIR, "app.db");

const sqlite = new Database(dbPath);
sqlite.pragma("busy_timeout = 10000");

export const db = drizzle(sqlite, { schema });

function isBusyError(error: unknown) {
  return error instanceof Error && (
    error.message.includes("database is locked")
    || error.message.includes("database is busy")
  );
}

function wait(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withBusyRetry<T>(operation: () => T, attempts = 20): T {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isBusyError(error)) throw error;
      lastError = error;
      wait(Math.min(1000, 50 * (attempt + 1)));
    }
  }
  throw lastError;
}

// Next.js 构建会在多个进程中加载路由模块。数据库初始化必须允许这些
// 进程短暂竞争同一个 SQLite 文件，而不是让构建因 SQLITE_BUSY 失败。
withBusyRetry(() => sqlite.pragma("journal_mode = WAL"));
withBusyRetry(() => sqlite.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  title TEXT, author TEXT, keyword TEXT,
  book_title TEXT, book_author TEXT, project_path TEXT, codex_thread_id TEXT,
  current_gate TEXT NOT NULL DEFAULT 'INTAKE',
  notes TEXT, stats TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input TEXT, output TEXT, error TEXT, progress REAL DEFAULT 0,
  started_at INTEGER, finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, step_name TEXT NOT NULL,
  kind TEXT NOT NULL, label TEXT, path TEXT, content TEXT, meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, node_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', progress REAL NOT NULL DEFAULT 0,
  message TEXT, artifact_path TEXT, error TEXT, attempt INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER, finished_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS publication_records (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, platform TEXT NOT NULL DEFAULT 'weixin_channels',
  account_id TEXT, status TEXT NOT NULL DEFAULT 'not_started', idempotency_key TEXT NOT NULL,
  draft_id TEXT, platform_work_id TEXT, url TEXT, uploaded_at INTEGER, published_at INTEGER,
  error TEXT, meta TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, publication_id TEXT NOT NULL,
  horizon TEXT NOT NULL, captured_at INTEGER NOT NULL, metrics TEXT NOT NULL,
  derived TEXT NOT NULL, review TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steps_task ON steps(task_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_task ON workflow_runs(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_task_node ON workflow_runs(task_id, node_key);
CREATE INDEX IF NOT EXISTS idx_publication_task ON publication_records(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_publication_idempotency ON publication_records(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_metrics_task ON metric_snapshots(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_publication_horizon ON metric_snapshots(publication_id, horizon);
`));

function ensureTaskColumn(name: string, definition: string) {
  const columns = withBusyRetry(
    () => sqlite.prepare("PRAGMA table_info(tasks)").all() as { name: string }[],
  );
  if (columns.some((column) => column.name === name)) return;
  try {
    withBusyRetry(() => sqlite.exec(`ALTER TABLE tasks ADD COLUMN ${definition}`));
  } catch (error) {
    // Next.js build workers may race after the PRAGMA check. If another worker
    // already added the same column, the migration is complete.
    if (!(error instanceof Error && error.message.includes("duplicate column name"))) throw error;
  }
}
ensureTaskColumn("notes", "notes TEXT");
ensureTaskColumn("project_path", "project_path TEXT");
ensureTaskColumn("current_gate", "current_gate TEXT NOT NULL DEFAULT 'INTAKE'");
ensureTaskColumn("codex_thread_id", "codex_thread_id TEXT");

export { schema };
