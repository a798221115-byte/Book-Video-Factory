import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// 任务表：一个抖音链接 = 一个 task
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  sourceUrl: text("source_url").notNull(),
  title: text("title"),
  author: text("author"),
  keyword: text("keyword"),
  bookTitle: text("book_title"),
  bookAuthor: text("book_author"),
  projectPath: text("project_path"),
  currentGate: text("current_gate").notNull().default("INTAKE"),
  notes: text("notes"),
  stats: text("stats"), // JSON: {likes, plays, comments...}
  status: text("status").notNull().default("created"), // created|running|done|failed
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// 步骤表：每个 task 下的 pipeline step
export const steps = sqliteTable("steps", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  name: text("name").notNull(), // extract|transcribe|rewrite|tts|subtitle|render
  status: text("status").notNull().default("pending"), // pending|running|done|failed
  input: text("input"),   // JSON
  output: text("output"), // JSON
  error: text("error"),
  progress: real("progress").default(0),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
});

// 产物表：每步产生的文件/文本，持久化、可见、可改
export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  stepName: text("step_name").notNull(),
  kind: text("kind").notNull(), // transcript|cleaned|rewrite|audio|subtitle|image|video|json
  label: text("label"),
  path: text("path"),    // 文件相对路径（data/tasks/{id}/...）
  content: text("content"), // 文本类产物直接存
  meta: text("meta"),    // JSON
  createdAt: integer("created_at").notNull(),
});

// 配置表：API key、模型选择等（也可走 .env）
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at").notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type Step = typeof steps.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type Setting = typeof settings.$inferSelect;
