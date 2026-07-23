import { getLLM } from "../providers/llm";
import { PROMPT_F_SPLIT } from "../prompts";
import { splitTextIntoChunks } from "../textChunks";

const LOCAL_SPLIT_MAX_CHARS = 120;

export type ScriptSegment = {
  idx: number;
  text: string;
};

export function normalizeSegments(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item: any) => typeof item === "string" ? item : item?.text)
    .map((text) => String(text || "").trim())
    .filter(Boolean);
}

export function parseSegmentArtifactMeta(meta: string | null | undefined): string[] {
  if (!meta) return [];
  try {
    return normalizeSegments(JSON.parse(meta)?.segments);
  } catch {
    return [];
  }
}

export function estimateSegmentDuration(text: string): number {
  return +Math.max(6, String(text || "").replace(/\s/g, "").length / 4.5).toFixed(3);
}

export function toScriptSegmentMeta(segments: string[]): ScriptSegment[] {
  return segments.map((text, idx) => ({ idx, text }));
}

export async function splitScriptSegments(task: any, script: string): Promise<string[]> {
  const text = String(script || "").trim();
  if (!text) return [];
  if (text.length > 5000) {
    return splitTextIntoChunks(text, LOCAL_SPLIT_MAX_CHARS);
  }
  const llm = getLLM();
  try {
    const raw = await llm.chat({
      system: PROMPT_F_SPLIT.system,
      user: PROMPT_F_SPLIT.user({
        keyword: task.keyword || "",
        title: task.title || "",
        author: task.author || "",
        script_text: text,
      }),
      temperature: 0.2,
      json: true,
    });
    const segments = normalizeSegments(JSON.parse(raw)?.segments);
    if (segments.length) return segments;
  } catch {
    // Fall back to deterministic local sentence chunking.
  }
  return splitTextIntoChunks(text, LOCAL_SPLIT_MAX_CHARS);
}
