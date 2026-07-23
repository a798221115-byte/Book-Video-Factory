import { getTask, setStepStatus, saveArtifact, getArtifacts, clearArtifacts, taskDir, projectArtifactPath, resolveArtifactPath } from "../pipeline/repo";
import { getTranscriptLLM } from "../providers/llm";
import { getAsr } from "../providers/asr";
import { PROMPT_A_CLEAN } from "../prompts";
import { splitTextIntoChunks } from "../textChunks";
import { normalizeSegmentedTranscript, toSimplifiedChinese } from "../chinese";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileP = promisify(execFile);
const CLEAN_CHUNK_MAX_CHARS = 1800;

// 从视频抽 16k 单声道 wav（whisper 友好，体积远小于原 mp4，对中转站更稳）
async function extractAudio16k(video: string, out: string): Promise<void> {
  await execFileP("ffmpeg", ["-y", "-nostdin", "-i", video, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", out], {
    maxBuffer: 1024 * 1024 * 64,
  });
}

async function cleanTranscriptChunk(
  llm: ReturnType<typeof getTranscriptLLM>,
  task: any,
  chunk: string,
  index: number,
  total: number,
): Promise<string> {
  return (await llm.chat({
    system: PROMPT_A_CLEAN.system,
    user: `【长文分块 ${index + 1}/${total}】\n${PROMPT_A_CLEAN.user({
      keyword: task.keyword || "",
      title: task.title || "",
      author: task.author || "",
      transcript: chunk,
    })}`,
    temperature: 0.1,
  })).trim();
}

export async function runTranscribe(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  clearArtifacts(taskId, "transcribe");

  // 1. 拿原始逐字稿：优先 extract 接口给的，否则对 source.mp4 跑 ASR
  const arts = getArtifacts(taskId);
  let rawAsr = arts.find((a) => a.stepName === "extract" && a.kind === "transcript")?.content;

  if (!rawAsr) {
    const videoArt = arts.find((a) => a.stepName === "extract" && a.kind === "video");
    if (!videoArt?.path) throw new Error("没有原始逐字稿，也没有视频可供 ASR 转写");
    setStepStatus(taskId, "transcribe", { progress: 0.2 });
    const dir = taskDir(taskId);
    const wav = path.join(dir, "asr_src.wav");
    await extractAudio16k(resolveArtifactPath(videoArt.path), wav);
    const asr = getAsr();
    try {
      const result = await asr.transcribe(wav);
      rawAsr = result.text;
    } finally {
      try { fs.unlinkSync(wav); } catch {}
    }
  }
  setStepStatus(taskId, "transcribe", { progress: 0.5 });

  const whisperTranscript = rawAsr!;
  rawAsr = toSimplifiedChinese(whisperTranscript);

  // ASR 完成后立即保存原始逐字稿。即使后续 LLM 清洗未配置或失败，
  // 本地 Whisper 的真实结果仍可查看和复用。
  const dir = taskDir(taskId);
  const clipsDir = path.join(dir, "video_clips");
  fs.mkdirSync(clipsDir, { recursive: true });
  if (whisperTranscript !== rawAsr) {
    const whisperRawPath = path.join(clipsDir, "raw-transcript-whisper.txt");
    fs.writeFileSync(whisperRawPath, whisperTranscript, "utf-8");
    saveArtifact({
      taskId,
      stepName: "transcribe",
      kind: "transcript_source_file",
      label: "Whisper 原始输出（审计）",
      path: projectArtifactPath(whisperRawPath),
    });
  }
  const rawPath = path.join(clipsDir, "raw-transcript.txt");
  fs.writeFileSync(rawPath, rawAsr!, "utf-8");
  saveArtifact({
    taskId,
    stepName: "transcribe",
    kind: "transcript",
    label: "简体原始逐字稿",
    content: rawAsr,
  });
  saveArtifact({
    taskId,
    stepName: "transcribe",
    kind: "transcript_file",
    label: "原始逐字稿文件",
    path: projectArtifactPath(rawPath),
  });

  // 2. 附件A 清洗
  const llm = getTranscriptLLM();
  const cleanChunks = splitTextIntoChunks(rawAsr!, CLEAN_CHUNK_MAX_CHARS);
  const cleanedChunks: string[] = [];
  const failedCleanChunks: { index: number; error: string }[] = [];
  if (cleanChunks.length <= 1) {
    cleanedChunks.push(await cleanTranscriptChunk(llm, task, rawAsr!, 0, 1));
  } else {
    for (let i = 0; i < cleanChunks.length; i++) {
      try {
        cleanedChunks.push(await cleanTranscriptChunk(llm, task, cleanChunks[i], i, cleanChunks.length));
      } catch (e: any) {
        failedCleanChunks.push({ index: i + 1, error: String(e?.message || e).slice(0, 160) });
        cleanedChunks.push(cleanChunks[i].replace(/\s+/g, " ").trim());
      }
      setStepStatus(taskId, "transcribe", { progress: 0.5 + 0.35 * ((i + 1) / cleanChunks.length) });
    }
  }
  const cleaned = normalizeSegmentedTranscript(
    cleanedChunks.map((s) => s.trim()).filter(Boolean).join("\n\n"),
  );
  setStepStatus(taskId, "transcribe", { progress: 0.9 });

  // 保存清洗稿（落盘 + 入库）
  const cleanedPath = path.join(clipsDir, "cleaned-transcript.txt");
  fs.writeFileSync(cleanedPath, cleaned, "utf-8");
  saveArtifact({
    taskId, stepName: "transcribe", kind: "cleaned", label: "清洗后正文",
    path: projectArtifactPath(cleanedPath), content: cleaned,
  });

  setStepStatus(taskId, "transcribe", {
    output: JSON.stringify({
      rawLen: rawAsr!.length,
      cleanedLen: cleaned.length,
      provider: llm.name,
      cleanChunks: cleanChunks.length,
      failedCleanChunks,
      warning: failedCleanChunks.length ? `${failedCleanChunks.length} 个长文分块清洗失败，已用原分块兜底` : null,
    }),
  });
}
