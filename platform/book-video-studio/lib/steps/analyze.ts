import fs from "node:fs";
import path from "node:path";
import { getBookLLM } from "../providers/llm";
import {
  clearArtifacts,
  getArtifacts,
  getTask,
  projectArtifactPath,
  renameTaskWorkDirForBook,
  saveArtifact,
  setStepStatus,
  taskDir,
  updateTask,
} from "../pipeline/repo";

type BookCandidate = {
  title: string;
  author: string;
  confidence: number;
  evidence: string[];
};

function parseJsonObject(raw: string) {
  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("分析模型没有返回有效 JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeCandidates(payload: any): BookCandidate[] {
  const raw = Array.isArray(payload?.book_candidates)
    ? payload.book_candidates
    : payload?.book_title
      ? [{
          title: payload.book_title,
          author: payload.book_author,
          confidence: payload.confidence,
          evidence: payload.evidence ? [payload.evidence] : [],
        }]
      : [];
  return raw.slice(0, 3).map((item: any) => ({
    title: String(item?.title || item?.book_title || "").replace(/[《》]/g, "").trim(),
    author: String(item?.author || item?.book_author || "").trim(),
    confidence: Math.max(0, Math.min(1, Number(item?.confidence || 0))),
    evidence: (Array.isArray(item?.evidence) ? item.evidence : [item?.evidence])
      .map((value: unknown) => String(value || "").trim())
      .filter(Boolean)
      .slice(0, 5),
  })).filter((item: BookCandidate) => item.title);
}

function structureMarkdown(payload: any, task: any) {
  const structure = payload?.viral_structure || {};
  const lines = [
    "# 抖音爆款结构分析",
    "",
    `- 来源标题：${task.title || "未获取"}`,
    `- 来源账号：${task.author || "未获取"}`,
    "- 使用边界：仅分析结构、节奏和包装，不直接复制为新视频文案。",
    "",
    "## 开头钩子",
    String(structure.hook || "未识别到稳定钩子"),
    "",
    "## 叙事结构",
    ...(Array.isArray(structure.beats) && structure.beats.length
      ? structure.beats.map((item: unknown, index: number) => `${index + 1}. ${String(item)}`)
      : ["1. 暂无可靠结构分析"]),
    "",
    "## 情绪曲线",
    String(structure.emotion_curve || "暂无可靠分析"),
    "",
    "## 金句与转折位置",
    ...(Array.isArray(structure.key_lines) && structure.key_lines.length
      ? structure.key_lines.map((item: unknown) => `- ${String(item)}`)
      : ["- 暂无可靠分析"]),
    "",
    "## 结尾动作",
    String(structure.cta || "未识别到明确 CTA"),
    "",
    "## 可借鉴的表达机制",
    ...(Array.isArray(structure.reusable_patterns) && structure.reusable_patterns.length
      ? structure.reusable_patterns.map((item: unknown) => `- ${String(item)}`)
      : ["- 等待人工补充"]),
    "",
  ];
  return lines.join("\n");
}

export async function runAnalyze(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  clearArtifacts(taskId, "analyze");

  const artifacts = getArtifacts(taskId);
  const cleaned = artifacts.find((item) =>
    item.stepName === "transcribe" && item.kind === "cleaned",
  )?.content?.trim();
  if (!cleaned) throw new Error("缺少清洗后的逐字稿");

  setStepStatus(taskId, "analyze", { progress: 0.15 });
  const llm = getBookLLM();
  const raw = await llm.chat({
    system: [
      "你是中文图书短视频的证据分析员。",
      "任务是从来源标题、账号和逐字稿中识别书名作者候选，并拆解爆款表达结构。",
      "不得改写或续写新口播稿，不得伪造书名作者。",
      "证据不足时降低 confidence，并明确说明缺失信息。",
      "这是信息抽取任务，只输出 JSON。",
    ].join("\n"),
    user: [
      "请返回以下 JSON 结构：",
      '{"book_candidates":[{"title":"","author":"","confidence":0,"evidence":[""]}],"viral_structure":{"hook":"","beats":[""],"emotion_curve":"","key_lines":[""],"cta":"","reusable_patterns":[""]}}',
      `来源标题：${task.title || ""}`,
      `来源账号：${task.author || ""}`,
      "逐字稿：",
      cleaned,
    ].join("\n\n"),
    temperature: 0.2,
    json: true,
  });
  setStepStatus(taskId, "analyze", { progress: 0.7 });

  const payload = parseJsonObject(raw);
  const candidates = normalizeCandidates(payload);
  const report = structureMarkdown(payload, task);
  if (candidates[0]?.title) {
    renameTaskWorkDirForBook(taskId, candidates[0].title);
  }
  const dir = path.join(taskDir(taskId), "video_clips");
  fs.mkdirSync(dir, { recursive: true });
  const candidatesPath = path.join(dir, "book-candidates.json");
  const reportPath = path.join(dir, "viral-structure-analysis.md");
  fs.writeFileSync(candidatesPath, JSON.stringify({
    candidates,
    provider: llm.name,
    generatedAt: new Date().toISOString(),
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(reportPath, report + "\n", "utf8");

  saveArtifact({
    taskId,
    stepName: "analyze",
    kind: "book_candidates",
    label: "书名作者候选",
    path: projectArtifactPath(candidatesPath),
    meta: { candidates, provider: llm.name },
  });
  saveArtifact({
    taskId,
    stepName: "analyze",
    kind: "viral_structure",
    label: "爆款结构分析",
    path: projectArtifactPath(reportPath),
    content: report,
    meta: { provider: llm.name },
  });

  updateTask(taskId, {
    status: "waiting_confirmation",
    currentGate: "BOOK_CONFIRMATION",
  });
  setStepStatus(taskId, "analyze", {
    progress: 1,
    output: JSON.stringify({
      provider: llm.name,
      candidates: candidates.length,
      waitingFor: "确认书名和作者",
    }),
  });
}
