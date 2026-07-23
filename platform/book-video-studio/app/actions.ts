"use server";
import { createTask, findTaskBySourceDuplicate, sourceDuplicateKey } from "@/lib/pipeline/repo";
import { ensureRegistered } from "@/lib/pipeline/register";
import { runPipeline } from "@/lib/pipeline/runner";
import { revalidatePath } from "next/cache";

export type ImportMode = "intake" | "manual" | "pipeline" | "collect" | "draft";
type CreateTaskOptions = { autoTranscribe?: boolean };
export type DuplicateImportItem = {
  inputUrl: string;
  duplicateKey: string;
  existing: {
    id: string;
    title: string | null;
    bookTitle: string | null;
    author: string | null;
    sourceUrl: string;
    createdAt: number;
    status: string;
  };
};
export type CreateTasksResult = {
  created: string[];
  duplicates: DuplicateImportItem[];
  requested: number;
};

function extractUrls(input: string): string[] {
  const matches = input.match(/https?:\/\/[^\s，。；,;]+/g);
  if (matches?.length) return Array.from(new Set(matches.map((s) => s.trim())));
  return input
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function startMode(id: string, mode: ImportMode, _options: CreateTaskOptions = {}) {
  ensureRegistered();
  if (mode === "intake") {
    runPipeline(id).catch((e) => console.error("[import:pipeline]", e));
  }
}

export async function createTaskAction(url: string, mode: ImportMode = "manual", options: CreateTaskOptions = {}) {
  const result = await createTasksAction(url, mode, options);
  const id = result.created[0] || result.duplicates[0]?.existing.id || "";
  revalidatePath("/");
  return id;
}

export async function createTasksAction(input: string, mode: ImportMode = "intake", options: CreateTaskOptions = {}) {
  const urls = extractUrls(input);
  const ids: string[] = [];
  const duplicates: DuplicateImportItem[] = [];
  const seenInBatch = new Map<string, string>();
  for (const url of urls) {
    const duplicateKey = sourceDuplicateKey(url);
    const batchDuplicate = seenInBatch.get(duplicateKey);
    const existing = findTaskBySourceDuplicate(url);
    if (batchDuplicate || existing) {
      const task = existing || (batchDuplicate ? findTaskBySourceDuplicate(batchDuplicate) : null);
      duplicates.push({
        inputUrl: url,
        duplicateKey,
        existing: task ? {
          id: task.id,
          title: task.title,
          bookTitle: task.bookTitle,
          author: task.author,
          sourceUrl: task.sourceUrl,
          createdAt: task.createdAt,
          status: task.status,
        } : {
          id: batchDuplicate || "",
          title: null,
          bookTitle: null,
          author: null,
          sourceUrl: batchDuplicate || url,
          createdAt: Date.now(),
          status: "created",
        },
      });
      continue;
    }
    const id = createTask(url);
    seenInBatch.set(duplicateKey, id);
    ids.push(id);
  }
  for (const id of ids) startMode(id, mode, options);
  revalidatePath("/");
  return { created: ids, duplicates, requested: urls.length };
}
