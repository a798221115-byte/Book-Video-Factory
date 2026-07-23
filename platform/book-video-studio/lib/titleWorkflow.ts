import { getArtifacts } from "./pipeline/repo";

export type TitleCandidate = {
  id: string;
  text: string;
  formulaId?: number;
  trigger?: string;
  formulaTemplate?: string;
  originalExample?: string;
  reason?: string;
};

export function readTitleWorkflowMeta(taskId: string) {
  const artifact = getArtifacts(taskId).find((item) => item.stepName === "rewrite" && item.kind === "json");
  if (!artifact?.meta) return {} as Record<string, any>;
  try {
    return JSON.parse(artifact.meta) as Record<string, any>;
  } catch {
    return {} as Record<string, any>;
  }
}

export function isTitleWorkflowComplete(meta: Record<string, any>) {
  return (
    meta.title_stage === "complete" &&
    Boolean(String(meta.selected_long_title || "").trim()) &&
    Boolean(String(meta.selected_short_title || "").trim())
  );
}

export function assertTitleWorkflowComplete(taskId: string) {
  if (!isTitleWorkflowComplete(readTitleWorkflowMeta(taskId))) {
    throw new Error("请先在标题选择中确认长标题，再确认短标题，完成后才能生成场景图");
  }
}
