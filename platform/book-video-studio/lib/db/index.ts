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
  book_title TEXT, book_author TEXT, project_path TEXT,
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
CREATE INDEX IF NOT EXISTS idx_steps_task ON steps(task_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);
`));

const taskColumns = withBusyRetry(
  () => sqlite.prepare("PRAGMA table_info(tasks)").all() as { name: string }[],
);
if (!taskColumns.some((column) => column.name === "notes")) {
  withBusyRetry(() => sqlite.exec("ALTER TABLE tasks ADD COLUMN notes TEXT"));
}
if (!taskColumns.some((column) => column.name === "project_path")) {
  withBusyRetry(() => sqlite.exec("ALTER TABLE tasks ADD COLUMN project_path TEXT"));
}
if (!taskColumns.some((column) => column.name === "current_gate")) {
  withBusyRetry(() => sqlite.exec("ALTER TABLE tasks ADD COLUMN current_gate TEXT NOT NULL DEFAULT 'INTAKE'"));
}

export { schema };
