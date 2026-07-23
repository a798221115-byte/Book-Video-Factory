import { getTask, setStepStatus, saveArtifact, getArtifacts, clearArtifacts, taskDir } from "../pipeline/repo";
import { getAsr } from "../providers/asr";
import { toSimplified } from "../providers/t2s";
import fs from "node:fs";
import path from "node:path";

const WORD_ALIGN_MAX_SEC = Math.max(60, Number(process.env.SUBTITLE_WORD_ALIGN_MAX_SEC) || 600);
const WORD_ALIGN_TIMEOUT_MS = Math.max(10_000, Number(process.env.SUBTITLE_WORD_ALIGN_TIMEOUT_MS) || 180_000);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时 ${Math.round(ms / 1000)}s`)), ms);
    promise.then(resolve, reject).finally(() => {
      if (timer) clearTimeout(timer);
    });
  });
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const f = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(f, 3)}`;
}

// 把一段文本切成 ≤ maxLen 字的短行（优先在标点处断；不在书名号/引号内部硬断）
function splitLines(text: string, maxLen = 15): string[] {
  const clean = text.replace(/\s+/g, "");
  const lines: string[] = [];
  let cur = "";
  let depth = 0; // 书名号/引号嵌套深度，>0 时不因超长而断行
  const OPEN = /[《「『“【（(]/;
  const CLOSE = /[》」』”】）)]/;
  for (const ch of clean) {
    if (OPEN.test(ch)) depth++;
    else if (CLOSE.test(ch) && depth > 0) depth--;
    cur += ch;
    const atPunct = /[，。！？、；：]/.test(ch);
    // 句末标点优先断；超长仅在不处于括号内时断
    if ((atPunct && depth === 0) || (cur.length >= maxLen && depth === 0)) {
      lines.push(cur.replace(/[，。！？、；：]$/, ""));
      cur = "";
    }
  }
  if (cur.trim()) lines.push(cur);
  return lines.filter(Boolean);
}

export async function runSubtitle(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  clearArtifacts(taskId, "subtitle");

  const arts = getArtifacts(taskId);
  const audio = arts.find((a) => a.stepName === "tts" && a.kind === "audio");
  if (!audio?.path) throw new Error("缺少 TTS 音频");
  const meta = audio.meta ? JSON.parse(audio.meta) : {};
  const segMeta: { text: string; dur: number }[] = meta.segments || [];
  if (!segMeta.length) throw new Error("TTS 段落时间轴缺失");

  // 可选：对 tts.wav 跑词级时间戳（真人声更准；Mock 静音会返回空，自动回退到按段比例）
  // Mock TTS 产出的是静音，跑 ASR 纯属浪费（必空），直接跳过走按段比例。
  setStepStatus(taskId, "subtitle", { progress: 0.3 });
  let words: { word: string; start: number; end: number }[] = [];
  const isMock = typeof meta.provider === "string" && meta.provider.startsWith("mock");
  const totalDur = Number(meta.totalDur || segMeta.reduce((sum, seg) => sum + Number(seg.dur || 0), 0));
  let wordAlignAttempted = false;
  let wordAlignSkipped: string | null = null;
  if (isMock) {
    wordAlignSkipped = "mock provider";
  } else if (totalDur > WORD_ALIGN_MAX_SEC) {
    wordAlignSkipped = `音频 ${Math.round(totalDur)}s 超过词级对齐阈值 ${WORD_ALIGN_MAX_SEC}s`;
  } else {
    wordAlignAttempted = true;
    try {
      const r = await withTimeout(
        getAsr().transcribe(path.resolve(audio.path), { wordTimestamps: true }),
        WORD_ALIGN_TIMEOUT_MS,
        "字幕词级 ASR"
      );
      if (Array.isArray(r.words) && r.words.length) words = r.words;
    } catch (e: any) {
      wordAlignSkipped = String(e?.message || e || "词级 ASR 失败，回退按段比例");
    }
  }

  // 按段落累计时间轴，段内按字数比例分配，切成短行
  setStepStatus(taskId, "subtitle", { progress: 0.7 });
  const cues: { start: number; end: number; text: string }[] = [];
  let t = 0;
  for (const seg of segMeta) {
    const lines = splitLines(seg.text);
    const totalChars = lines.reduce((n, l) => n + l.length, 0) || 1;
    let segT = t;
    for (const line of lines) {
      const lineDur = (line.length / totalChars) * seg.dur;
      cues.push({ start: segT, end: segT + lineDur, text: line });
      segT += lineDur;
    }
    t += seg.dur;
  }

  // 词级对齐：若拿到 ASR 词级时间戳，用「逐字流水匹配」校准每个 cue 的真实起止，
  // 取代纯按字数比例的近似（真人声下口播节奏不均，比例法会漂移）。
  // 做法：把全部 cue 文本展平成字符流，与 ASR 字符流（去标点/空白）顺序对齐，
  // 命中则用 ASR 时间，未命中保留比例估时，最后保证时间轴单调不回退。
  let alignedByWords = false;
  if (words.length) {
    // 归一化：去标点/空白/数字 + 繁→简折叠。
    //  - 繁→简：云 Whisper 可能输出繁体，cue 文本是简体，不折叠则匹配率极低。
    //  - 去数字：清洗稿把阿拉伯数字转成了中文数字（50→五十），与 ASR 的 "50" 对不上，
    //    直接剔除数字字符避免错配（数字占比低，对时间锚点影响小）。
    // 折叠/剔除仅用于匹配，cue 展示文本保持原样不变。
    const norm = (s: string) => toSimplified(s.replace(/[\s，。！？、；：,.!?；0-9]/g, ""));
    const aw = words
      .map((w) => ({ ch: norm(w.word), start: w.start, end: w.end }))
      .filter((w) => w.ch.length > 0);
    // ASR 字符流（一个 word 可能含多字，逐字展开，时间均分）
    const stream: { ch: string; start: number; end: number }[] = [];
    for (const w of aw) {
      const chars = [...w.ch];
      const per = chars.length ? (w.end - w.start) / chars.length : 0;
      chars.forEach((c, i) => stream.push({ ch: c, start: w.start + per * i, end: w.start + per * (i + 1) }));
    }
    let si = 0; // ASR 流游标
    let hits = 0, totalCueChars = 0;
    for (const cue of cues) {
      const chars = [...norm(cue.text)];
      totalCueChars += chars.length;
      let firstStart = -1, lastEnd = -1;
      for (const c of chars) {
        // 在 ASR 流里向后找匹配字（最多看 6 个，容忍 ASR 漏字/错字）
        let found = -1;
        for (let k = si; k < Math.min(si + 6, stream.length); k++) {
          if (stream[k].ch === c) { found = k; break; }
        }
        if (found >= 0) {
          if (firstStart < 0) firstStart = stream[found].start;
          lastEnd = stream[found].end;
          si = found + 1;
          hits++;
        }
      }
      if (firstStart >= 0 && lastEnd > firstStart) {
        cue.start = firstStart;
        cue.end = lastEnd;
      }
    }
    // 命中率够高才认定"已词级对齐"（否则文本与 ASR 差异大，保留比例法更稳）。
    // 阈值 0.5：繁简/数字/漏字折损后，真人声实测同范围命中常 ~85%+，0.5 留足余量。
    alignedByWords = totalCueChars > 0 && hits / totalCueChars >= 0.5;
    // 单调化：修正个别 cue 因漏字导致的时间回退/重叠
    for (let i = 1; i < cues.length; i++) {
      if (cues[i].start < cues[i - 1].end) cues[i].start = cues[i - 1].end;
      if (cues[i].end <= cues[i].start) cues[i].end = cues[i].start + 0.3;
    }
  }

  // 生成 SRT + 结构化 cues.json（供 render 叠加用）
  const srt = cues.map((c, i) =>
    `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
  const dir = taskDir(taskId);
  const srtPath = path.join(dir, "subtitle.srt");
  fs.writeFileSync(srtPath, srt, "utf-8");
  const cuesPath = path.join(dir, "cues.json");
  fs.writeFileSync(cuesPath, JSON.stringify(cues), "utf-8");

  saveArtifact({
    taskId, stepName: "subtitle", kind: "srt", label: "字幕 subtitle.srt",
    path: path.relative(process.cwd(), srtPath),
    content: srt.length > 2000 ? srt.slice(0, 2000) + "\n…(截断)" : srt,
    meta: {
      cues: cues.length,
      alignedByWords,
      wordAlignAttempted,
      wordAlignSkipped,
      wordAlignMaxSec: WORD_ALIGN_MAX_SEC,
      wordAlignTimeoutMs: WORD_ALIGN_TIMEOUT_MS,
    },
  });
  saveArtifact({
    taskId, stepName: "subtitle", kind: "cues", label: "字幕时间轴",
    path: path.relative(process.cwd(), cuesPath),
  });
  setStepStatus(taskId, "subtitle", {
    output: JSON.stringify({ cues: cues.length, alignedByWords, wordAlignSkipped }),
  });
}
