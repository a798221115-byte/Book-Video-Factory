// ASR Provider：云端 Whisper（OpenAI 兼容）/ 腾讯云 / 本地 whisper.cpp / Mock。返回纯文本（+可选词级时间戳）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tc3Headers } from "./tencent-sign";

const execFileP = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN?.trim() || "ffmpeg";

export interface AsrWord { word: string; start: number; end: number }
export interface AsrResult { text: string; words?: AsrWord[] }

export interface AsrProvider {
  readonly name: string;
  transcribe(audioPath: string, opts?: { wordTimestamps?: boolean }): Promise<AsrResult>;
}

// 把任意音频/视频转成 16k 单声道 wav（whisper.cpp 要求）
async function toWav16k(input: string): Promise<string> {
  const out = path.join(os.tmpdir(), `asr_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
  await execFileP(FFMPEG_BIN, ["-y", "-i", input, "-ar", "16000", "-ac", "1", "-f", "wav", out], {
    maxBuffer: 1024 * 1024 * 64,
  });
  return out;
}

// 转 16k 单声道 MP3（腾讯云同步直传体积小，~24kbps 下 4 分钟约 0.7MB）
async function toMp3_16k(input: string): Promise<string> {
  const out = path.join(os.tmpdir(), `asr_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
  await execFileP(FFMPEG_BIN, ["-y", "-i", input, "-ar", "16000", "-ac", "1", "-b:a", "32k", out], {
    maxBuffer: 1024 * 1024 * 64,
  });
  return out;
}

// ---------- 云端 Whisper（OpenAI 兼容 /audio/transcriptions）----------
class CloudWhisperProvider implements AsrProvider {
  readonly name = "cloud-whisper";
  constructor(private apiKey: string, private baseUrl: string, private model: string) {}
  async transcribe(audioPath: string, opts?: { wordTimestamps?: boolean }): Promise<AsrResult> {
    // 中转站上游偶发 500/超时（do_request_failed），重试 3 次指数退避
    let lastErr: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.once(audioPath, opts);
      } catch (e: any) {
        lastErr = e;
        // 仅对疑似瞬时上游错误重试（5xx / do_request_failed / 网络），4xx 直接抛
        const msg = String(e?.message || e);
        const transient = /\b5\d\d\b|do_request_failed|upstream|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg);
        if (!transient || attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      }
    }
    throw lastErr;
  }
  private async once(audioPath: string, opts?: { wordTimestamps?: boolean }): Promise<AsrResult> {
    const buf = fs.readFileSync(audioPath);
    const form = new FormData();
    form.append("file", new Blob([buf]), audioPath.split("/").pop() || "audio.wav");
    form.append("model", this.model);
    if (opts?.wordTimestamps) {
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "word");
    }
    const resp = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!resp.ok) throw new Error(`Whisper ${resp.status}: ${await resp.text()}`);
    const json: any = await resp.json();
    return {
      text: json.text ?? "",
      words: Array.isArray(json.words)
        ? json.words.map((w: any) => ({ word: w.word, start: w.start, end: w.end }))
        : undefined,
    };
  }
}

// ---------- 本地 whisper.cpp（whisper-cli）----------
class LocalWhisperCppProvider implements AsrProvider {
  readonly name = "local-whisper-cpp";
  constructor(private modelPath: string, private bin = "whisper-cli", private lang = "zh") {}
  async transcribe(audioPath: string, opts?: { wordTimestamps?: boolean }): Promise<AsrResult> {
    const wav = await toWav16k(audioPath);
    const outBase = wav.replace(/\.wav$/, "");
    const wantWords = opts?.wordTimestamps !== false; // 默认要词级（字幕对齐用）
    try {
      // -ojf 输出含 token 级时间戳的完整 JSON；--prompt 提示简体中文（whisper 默认易出繁体）
      const args = ["-m", this.modelPath, "-f", wav, "-l", this.lang, "-of", outBase, "-np"];
      if (wantWords) args.push("-ojf"); else args.push("-oj");
      if (this.lang === "zh") args.push("--prompt", "以下是简体中文普通话的句子。");
      await execFileP(this.bin, args, { maxBuffer: 1024 * 1024 * 128 });
      const jsonPath = `${outBase}.json`;
      // whisper.cpp JSON 偶含非法 UTF-8 字节（多字节 token 边界），容错读取
      const raw = fs.readFileSync(jsonPath, "utf-8");
      const j: any = JSON.parse(raw);
      const segs: any[] = j.transcription ?? [];
      const text = segs.map((s) => s.text).join("").trim();
      const words = wantWords ? tokensToWords(segs) : segToWords(segs);
      try { fs.unlinkSync(jsonPath); } catch {}
      return { text, words: words.length ? words : undefined };
    } finally {
      try { fs.unlinkSync(wav); } catch {}
    }
  }
}

// 段级近似词（无 token 时的兜底）：每段一个"词"
function segToWords(segs: any[]): AsrWord[] {
  return segs
    .filter((s) => s.offsets)
    .map((s) => ({
      word: (s.text || "").trim(),
      start: (s.offsets.from ?? 0) / 1000,
      end: (s.offsets.to ?? 0) / 1000,
    }));
}

/**
 * 把 whisper.cpp 的 token 级时间戳重建为「字级」时间戳（用于字幕对齐）。
 * 中文一个汉字常被切成多个 UTF-8 字节 token，whisper 已把不成形的字节替换成 �（不可还原），
 * 故只取「已成形的干净字符 token」(含其精确 from/to)，丢弃 � 碎片。被整体丢失的字会留下
 * 时间空隙，由下游 subtitle 对齐时按已知文本插值补齐。一个 token 含多字时按时长均分。
 */
function tokensToWords(segs: any[]): AsrWord[] {
  const words: AsrWord[] = [];
  for (const seg of segs) {
    const toks: any[] = seg.tokens || [];
    for (const t of toks) {
      const txt: string = (t.text ?? "");
      if (/^\[.*\]$/.test(txt)) continue;        // 特殊 token [_BEG_]/[_TT_400] 等
      if (!txt || txt.includes("�")) continue; // 跳过空 / � 碎片
      const clean = txt.trim();
      if (!clean) continue;
      const from = (t.offsets?.from ?? 0) / 1000;
      const to = Math.max(from, (t.offsets?.to ?? 0) / 1000);
      const chars = [...clean];
      const per = chars.length ? (to - from) / chars.length : 0;
      chars.forEach((ch, i) => words.push({ word: ch, start: from + per * i, end: from + per * (i + 1) }));
    }
  }
  // 保险：token 路径没拿到任何字（极端情况）→ 回退段级
  return words.length ? words : segToWords(segs);
}

// ---------- 腾讯云录音文件识别（CreateRecTask 异步 + 轮询，含词级时间戳）----------
class TencentAsrProvider implements AsrProvider {
  readonly name = "tencent-asr";
  private host = "asr.tencentcloudapi.com";
  private version = "2019-06-14";
  constructor(private secretId: string, private secretKey: string, private region = "ap-guangzhou") {}

  private async call(action: string, payload: any): Promise<any> {
    const body = JSON.stringify(payload);
    const headers = tc3Headers({
      secretId: this.secretId, secretKey: this.secretKey, host: this.host,
      service: "asr", action, version: this.version, region: this.region, payload: body,
    });
    const resp = await fetch(`https://${this.host}`, { method: "POST", headers, body });
    const json: any = await resp.json();
    if (json?.Response?.Error) {
      throw new Error(`腾讯云ASR ${json.Response.Error.Code}: ${json.Response.Error.Message}`);
    }
    return json?.Response;
  }

  async transcribe(audioPath: string, _opts?: { wordTimestamps?: boolean }): Promise<AsrResult> {
    // 转 16k 单声道 MP3：腾讯云同步直传 Data 限 5MB，PCM wav 太大，MP3 压缩后长音频也能放下
    const mp3 = await toMp3_16k(audioPath);
    try {
      const data = fs.readFileSync(mp3);
      if (data.length > 5 * 1024 * 1024) {
        throw new Error(`腾讯云ASR 音频过大(${(data.length / 1048576).toFixed(1)}MB>5MB)，超同步接口上限`);
      }
      const b64 = data.toString("base64");
      // 1. 建任务（ResTextFormat=2 返回词级时间戳；引擎自动识别 mp3/wav 格式）
      const created = await this.call("CreateRecTask", {
        EngineModelType: "16k_zh", ChannelNum: 1, ResTextFormat: 2,
        SourceType: 1, Data: b64, DataLen: data.length,
      });
      const taskId = created?.Data?.TaskId;
      if (!taskId) throw new Error("腾讯云ASR 未返回 TaskId");
      // 2. 轮询结果（4 分钟音频通常很快，最多等 ~3 分钟）
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const st = await this.call("DescribeTaskStatus", { TaskId: taskId });
        const d = st?.Data || {};
        if (d.StatusStr === "success") return this.parse(d);
        if (d.StatusStr === "failed") throw new Error(`腾讯云ASR 失败: ${d.ErrorMsg || "unknown"}`);
      }
      throw new Error("腾讯云ASR 轮询超时");
    } finally {
      try { fs.unlinkSync(mp3); } catch {}
    }
  }

  private parse(d: any): AsrResult {
    const details: any[] = d.ResultDetail || [];
    const words: AsrWord[] = [];
    for (const seg of details) {
      const base = seg.StartMs ?? 0;
      for (const w of seg.Words || []) {
        words.push({
          word: w.Word,
          start: (base + (w.OffsetStartMs ?? 0)) / 1000,
          end: (base + (w.OffsetEndMs ?? 0)) / 1000,
        });
      }
    }
    const text = details.length
      ? details.map((s) => s.FinalSentence || "").join("")
      : String(d.Result || "").replace(/\[[^\]]*\]\s*/g, "").trim();
    return { text: text.trim(), words: words.length ? words : undefined };
  }
}

class MockAsrProvider implements AsrProvider {
  readonly name = "mock";
  async transcribe(_p: string, opts?: { wordTimestamps?: boolean }): Promise<AsrResult> {
    await new Promise((r) => setTimeout(r, 500));
    const text = "这是 Mock ASR 转写出来的逐字稿文本，用于本地流程跑通测试。";
    if (opts?.wordTimestamps) {
      const chars = [...text];
      const dur = 0.25;
      return { text, words: chars.map((c, i) => ({ word: c, start: i * dur, end: (i + 1) * dur })) };
    }
    return { text };
  }
}

// 失败兜底链：按顺序尝试，前一个抛错/无文本则切下一个
class FallbackAsrProvider implements AsrProvider {
  readonly name: string;
  constructor(private chain: AsrProvider[]) {
    this.name = chain.map((p) => p.name).join(">");
  }
  async transcribe(audioPath: string, opts?: { wordTimestamps?: boolean }): Promise<AsrResult> {
    let lastErr: any;
    for (let i = 0; i < this.chain.length; i++) {
      const p = this.chain[i];
      try {
        const r = await p.transcribe(audioPath, opts);
        if (r.text && r.text.trim()) return r;
        lastErr = new Error(`${p.name} 返回空文本`);
      } catch (e: any) {
        lastErr = e;
      }
      if (i < this.chain.length - 1) {
        console.warn(`[asr] ${p.name} 失败，切换下一个兜底:`, String(lastErr?.message || lastErr).slice(0, 160));
      }
    }
    throw new Error(`所有 ASR 通道均失败: ${String(lastErr?.message || lastErr).slice(0, 200)}`);
  }
}

// 选择逻辑（带兜底链）：中转站 Whisper → 腾讯云 ASR → 本地 whisper.cpp → Mock
export function getAsr(): AsrProvider {
  const chain: AsrProvider[] = [];

  const key = process.env.ASR_API_KEY?.trim();
  if (key) {
    chain.push(new CloudWhisperProvider(
      key,
      process.env.ASR_BASE_URL?.trim() || "https://api.openai.com/v1",
      process.env.ASR_MODEL?.trim() || "whisper-1",
    ));
  }

  const tcId = process.env.TENCENT_SECRET_ID?.trim();
  const tcKey = process.env.TENCENT_SECRET_KEY?.trim();
  if (tcId && tcKey) {
    chain.push(new TencentAsrProvider(tcId, tcKey, process.env.TENCENT_ASR_REGION?.trim() || "ap-guangzhou"));
  }

  const modelPath = process.env.ASR_MODEL_PATH?.trim();
  if (modelPath && fs.existsSync(modelPath)) {
    chain.push(new LocalWhisperCppProvider(modelPath, process.env.WHISPER_CLI_BIN?.trim() || "whisper-cli"));
  }

  if (!chain.length) {
    if (process.env.ALLOW_MOCK_PROVIDERS === "1") return new MockAsrProvider();
    throw new Error("未配置可用 ASR。请配置 ASR_API_KEY、腾讯云 ASR 或本地 whisper.cpp。");
  }
  if (chain.length === 1) return chain[0];
  return new FallbackAsrProvider(chain);
}
