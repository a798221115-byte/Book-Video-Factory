// TTS Provider：本地 index-tts2 worker / Replicate(indextts-2) / macOS say / Mock。输出 wav 文件路径。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface TtsResult { wavPath: string; durationSec: number }
export type TtsProgressEvent = {
  provider?: string;
  mode?: "async-job" | "sync";
  jobId?: string;
  jobStatus?: string;
  jobProgress?: number;
  queuePosition?: number | null;
  elapsedSeconds?: number | null;
  message?: string;
};
export type TtsOptions = { voice?: string; speed?: number; onProgress?: (event: TtsProgressEvent) => void };

export interface TtsProvider {
  readonly name: string;
  // 合成一段文本为 wav，写到 outPath
  synthesize(text: string, outPath: string, opts?: TtsOptions): Promise<TtsResult>;
}

function describeFetchFailure(e: any): string {
  const cause = e?.cause;
  const parts = [
    cause?.code,
    cause?.address && cause?.port ? `${cause.address}:${cause.port}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : String(e?.message || e);
}

async function probeDuration(wav: string): Promise<number> {
  try {
    const { stdout } = await execFileP("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", wav,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : 0;
  } catch { return 0; }
}

function notifyTtsProgress(opts: TtsOptions | undefined, event: TtsProgressEvent) {
  try { opts?.onProgress?.(event); } catch { /* progress callbacks are best-effort */ }
}

function clamp01(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(1, n));
}

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

type IndexTtsJob = {
  id?: string;
  job_id?: string;
  status?: string;
  progress?: number;
  elapsed_seconds?: number;
  queue_position?: number | null;
  audio_url?: string | null;
  error?: string | null;
};

class IndexTtsAsyncUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexTtsAsyncUnsupportedError";
  }
}

function unwrapIndexTtsJob(payload: any): IndexTtsJob {
  return payload?.job && typeof payload.job === "object" ? payload.job : payload;
}

function jobIdOf(job: IndexTtsJob): string {
  return String(job.id || job.job_id || "").trim();
}

// ---------- 远程 index-tts2 worker（优先 POST /tts/jobs 异步任务，兼容 POST /tts）----------
// 典型部署：Windows(4070S) 上跑 server.py，Mac 设 INDEX_TTS2_URL=http://<win局域网IP>:7860
class IndexTts2Provider implements TtsProvider {
  readonly name = "index-tts2";
  private baseUrl: string;

  constructor(
    baseUrl: string,
    private jobTimeoutMs = 900_000,
    private defaultVoice = "default",
    private requestTimeoutMs = 30_000,
    private syncTimeoutMs = 120_000,
    private pollMs = 3_000,
    private asyncEnabled = true,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async synthesize(text: string, outPath: string, opts?: TtsOptions): Promise<TtsResult> {
    if (this.asyncEnabled) {
      try {
        return await this.synthesizeAsync(text, outPath, opts);
      } catch (e: any) {
        if (!(e instanceof IndexTtsAsyncUnsupportedError)) throw e;
        notifyTtsProgress(opts, {
          provider: this.name,
          mode: "sync",
          message: "Windows TTS worker 不支持异步 job API，已切回旧 /tts 接口",
        });
      }
    }
    return this.synthesizeSyncWithRetries(text, outPath, opts);
  }

  private async synthesizeAsync(text: string, outPath: string, opts?: TtsOptions): Promise<TtsResult> {
    const voice = opts?.voice || this.defaultVoice;
    notifyTtsProgress(opts, { provider: this.name, mode: "async-job", jobStatus: "creating", jobProgress: 0 });
    const createResp = await this.fetchWithTimeout(`${this.baseUrl}/tts/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    }, this.requestTimeoutMs, "创建 TTS job");
    if (!createResp.ok) {
      const body = (await createResp.text()).slice(0, 200);
      if (createResp.status === 404 || createResp.status === 405) {
        throw new IndexTtsAsyncUnsupportedError(`index-tts2 不支持异步任务接口 ${createResp.status}: ${body}`);
      }
      throw new Error(`index-tts2 创建 TTS job 失败 ${createResp.status}: ${body}`);
    }

    const created = await createResp.json();
    let job = unwrapIndexTtsJob(created);
    const jobId = jobIdOf(job);
    if (!jobId) throw new Error("index-tts2 创建 TTS job 后未返回 job id");
    notifyTtsProgress(opts, {
      provider: this.name,
      mode: "async-job",
      jobId,
      jobStatus: job.status || "queued",
      jobProgress: clamp01(job.progress) ?? 0,
      queuePosition: job.queue_position ?? null,
      elapsedSeconds: job.elapsed_seconds ?? null,
    });

    const deadline = Date.now() + this.jobTimeoutMs;
    let pollMisses = 0;
    while (true) {
      if (Date.now() > deadline) {
        throw new Error(`index-tts2 异步任务超时(${this.jobTimeoutMs}ms)，job=${jobId}。任务可能仍在 Windows worker 中运行，可检查 /status。`);
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
      let pollResp: Response;
      try {
        pollResp = await this.fetchWithTimeout(`${this.baseUrl}/tts/jobs/${encodeURIComponent(jobId)}`, {
          method: "GET",
        }, this.requestTimeoutMs, "轮询 TTS job");
      } catch (e: any) {
        pollMisses += 1;
        const msg = describeFetchFailure(e);
        notifyTtsProgress(opts, {
          provider: this.name,
          mode: "async-job",
          jobId,
          jobStatus: job.status || "unknown",
          jobProgress: clamp01(job.progress),
          queuePosition: job.queue_position ?? null,
          elapsedSeconds: job.elapsed_seconds ?? null,
          message: `轮询暂时无响应(${pollMisses})：${msg.slice(0, 100)}`,
        });
        continue;
      }
      pollMisses = 0;
      if (!pollResp.ok) throw new Error(`index-tts2 轮询 TTS job 失败 ${pollResp.status}: ${(await pollResp.text()).slice(0, 200)}`);
      job = unwrapIndexTtsJob(await pollResp.json());
      const status = String(job.status || "unknown");
      notifyTtsProgress(opts, {
        provider: this.name,
        mode: "async-job",
        jobId,
        jobStatus: status,
        jobProgress: clamp01(job.progress),
        queuePosition: job.queue_position ?? null,
        elapsedSeconds: job.elapsed_seconds ?? null,
      });
      if (status === "failed" || status === "canceled") {
        throw new Error(`index-tts2 TTS job ${status}: ${String(job.error || "unknown error").slice(0, 200)}`);
      }
      if (status === "succeeded") break;
    }

    notifyTtsProgress(opts, {
      provider: this.name,
      mode: "async-job",
      jobId,
      jobStatus: "downloading",
      jobProgress: 1,
      elapsedSeconds: job.elapsed_seconds ?? null,
    });
    const audioResp = await this.fetchWithTimeout(`${this.baseUrl}/tts/jobs/${encodeURIComponent(jobId)}/audio`, {
      method: "GET",
    }, this.requestTimeoutMs, "下载 TTS 音频");
    if (!audioResp.ok) throw new Error(`index-tts2 下载 TTS 音频失败 ${audioResp.status}: ${(await audioResp.text()).slice(0, 200)}`);
    await this.writeAudio(outPath, Buffer.from(await audioResp.arrayBuffer()));
    return { wavPath: outPath, durationSec: await probeDuration(outPath) };
  }

  private async synthesizeSyncWithRetries(text: string, outPath: string, opts?: TtsOptions): Promise<TtsResult> {
    // 跨机器调用偶发网络抖动/服务忙，重试 3 次指数退避
    let lastErr: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        notifyTtsProgress(opts, { provider: this.name, mode: "sync", message: `旧 /tts 接口合成，第 ${attempt + 1}/3 次` });
        return await this.synthesizeSyncOnce(text, outPath, opts);
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message || e);
        const transient = /\b5\d\d\b|timeout|aborted|ECONNRESET|ECONNREFUSED|fetch failed|network/i.test(msg);
        if (!transient || attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    throw lastErr;
  }

  private async synthesizeSyncOnce(text: string, outPath: string, opts?: TtsOptions): Promise<TtsResult> {
    try {
      const resp = await this.fetchWithTimeout(`${this.baseUrl}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: opts?.voice || this.defaultVoice }),
      }, this.syncTimeoutMs, "调用旧 /tts 接口");
      if (!resp.ok) throw new Error(`index-tts2 ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      await this.writeAudio(outPath, Buffer.from(await resp.arrayBuffer()));
      return { wavPath: outPath, durationSec: await probeDuration(outPath) };
    } catch (e: any) {
      if (String(e?.message || e) === "fetch failed") {
        throw new Error(`index-tts2 连接失败：无法访问 ${this.baseUrl}/tts（${describeFetchFailure(e)}）。请检查 TTS worker 是否启动、IP/端口是否正确。`);
      }
      throw e;
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, action: string): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error(`index-tts2 ${action}请求超时(${timeoutMs}ms)：${url}`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private async writeAudio(outPath: string, buf: Buffer): Promise<void> {
    if (buf.length < 44) throw new Error("index-tts2 返回音频过小，疑似空响应");
    fs.writeFileSync(outPath, buf);
    // 远程可能返回任意采样率，统一转 24k/mono/pcm_s16le，与 concat 拼接格式一致
    const norm = outPath.replace(/\.wav$/i, "") + ".norm.wav";
    await execFileP("ffmpeg", ["-y", "-nostdin", "-i", outPath, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", norm]);
    fs.renameSync(norm, outPath);
  }
}

// ---------- Replicate lucataco/indextts-2（predictions API 轮询）----------
// 无本地 GPU worker 时的云端兜底：POST 建 prediction → 轮询 status → 下载 output wav。
// 需 REPLICATE_API_TOKEN；可选 REPLICATE_INDEXTTS2_VERSION 指定模型版本号，
// REPLICATE_VOICE_URL 提供参考音色（声音克隆）的公网 wav 链接。
class ReplicateTtsProvider implements TtsProvider {
  readonly name = "replicate-indextts2";
  private base = "https://api.replicate.com/v1";
  constructor(
    private token: string,
    private version = process.env.REPLICATE_INDEXTTS2_VERSION?.trim() || "",
    private model = process.env.REPLICATE_INDEXTTS2_MODEL?.trim() || "lucataco/indextts-2",
    private timeoutMs = Number(process.env.REPLICATE_TIMEOUT_MS) || 180_000,
  ) {}

  async synthesize(text: string, outPath: string, opts?: TtsOptions): Promise<TtsResult> {
    const safe = text.replace(/\s+/g, " ").trim();
    if (!safe) throw new Error("Replicate TTS: 空文本");
    // 参考音色：opts.voice 若是 http(s) 链接则用作克隆参考，否则用 env 默认
    const voiceUrl = (opts?.voice && /^https?:\/\//.test(opts.voice) ? opts.voice : "")
      || process.env.REPLICATE_VOICE_URL?.trim() || "";
    const input: Record<string, any> = { text: safe };
    if (voiceUrl) { input.speaker = voiceUrl; input.reference_audio = voiceUrl; input.voice = voiceUrl; }

    // 1. 建 prediction：有 version 用 /predictions，否则用 /models/<owner>/<name>/predictions
    const createUrl = this.version
      ? `${this.base}/predictions`
      : `${this.base}/models/${this.model}/predictions`;
    const createBody = this.version ? { version: this.version, input } : { input };
    const created = await this.fetchJson(createUrl, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json", Prefer: "wait" }),
      body: JSON.stringify(createBody),
    });

    // 2. 轮询直到终态（Prefer: wait 多数情况下首响应已 succeeded）
    let pred = created;
    const deadline = Date.now() + this.timeoutMs;
    while (pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled") {
      if (Date.now() > deadline) throw new Error(`Replicate TTS 轮询超时(${this.timeoutMs}ms)`);
      await new Promise((r) => setTimeout(r, 1500));
      pred = await this.fetchJson(`${this.base}/predictions/${pred.id}`, {
        method: "GET", headers: this.headers(),
      });
    }
    if (pred.status !== "succeeded") {
      throw new Error(`Replicate TTS ${pred.status}: ${String(pred.error || "").slice(0, 200)}`);
    }

    // 3. output 可能是 url 字符串或字符串数组，取第一个音频链接下载
    const out = pred.output;
    const audioUrl: string | undefined = Array.isArray(out) ? out[0] : (typeof out === "string" ? out : out?.audio);
    if (!audioUrl) throw new Error("Replicate TTS: 输出无音频 URL");
    const ab = await fetch(audioUrl, { headers: this.headers() });
    if (!ab.ok) throw new Error(`Replicate TTS 下载音频失败 ${ab.status}`);
    const buf = Buffer.from(await ab.arrayBuffer());
    if (buf.length < 44) throw new Error("Replicate TTS: 音频过小，疑似空响应");
    fs.writeFileSync(outPath, buf);
    // 统一转 24k/mono/pcm_s16le，与本地 concat 拼接格式一致
    const norm = outPath.replace(/\.wav$/i, "") + ".norm.wav";
    await execFileP("ffmpeg", ["-y", "-nostdin", "-i", outPath, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", norm]);
    fs.renameSync(norm, outPath);
    return { wavPath: outPath, durationSec: await probeDuration(outPath) };
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, ...extra };
  }
  private async fetchJson(url: string, init: RequestInit): Promise<any> {
    const resp = await fetch(url, init);
    if (!resp.ok) throw new Error(`Replicate ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    return resp.json();
  }
}

// ---------- macOS say：本机自带中文人声，零依赖真人声（默认优先于 Mock）----------
class SayTtsProvider implements TtsProvider {
  readonly name = "macos-say";
  constructor(private voice = "Tingting", private rate = 180) {}
  async synthesize(text: string, outPath: string, opts?: TtsOptions): Promise<TtsResult> {
    const voice = opts?.voice && opts.voice !== "default" ? opts.voice : this.voice;
    const aiff = outPath.replace(/\.wav$/i, "") + ".aiff";
    // say 对空/纯标点文本可能产出无效音频，兜底给个占位字
    const safe = text.replace(/\s+/g, " ").trim() || "。";
    // say 合成 aiff（中文需指定中文 voice，否则乱读）
    await execFileP("say", ["-v", voice, "-r", String(this.rate), "-o", aiff, safe]);
    if (!fs.existsSync(aiff)) throw new Error(`say 未产出音频(voice=${voice})，请确认该中文语音已安装`);
    // 统一转 24k/mono/pcm_s16le wav，与拼接格式一致
    await execFileP("ffmpeg", ["-y", "-nostdin", "-i", aiff, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", outPath]);
    try { fs.unlinkSync(aiff); } catch {}
    return { wavPath: outPath, durationSec: await probeDuration(outPath) };
  }
}

// ---------- Mock：按字数估时长，用 ffmpeg 生成静音 wav，让链路跑通 ----------
class MockTtsProvider implements TtsProvider {
  readonly name = "mock-tts";
  async synthesize(text: string, outPath: string, opts?: TtsOptions): Promise<TtsResult> {
    // 中文约 4.5 字/秒；最少 1.2 秒
    const chars = [...text.replace(/\s/g, "")].length;
    const dur = Math.max(1.2, +(chars / 4.5).toFixed(2));
    await execFileP("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
      "-t", String(dur), "-c:a", "pcm_s16le", outPath,
    ]);
    return { wavPath: outPath, durationSec: dur };
  }
}

export function getTts(): TtsProvider {
  // 显式选择（mock|say|index-tts2|replicate）优先
  const pick = process.env.TTS_PROVIDER?.trim().toLowerCase();
  const url = process.env.INDEX_TTS2_URL?.trim();
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  const jobTimeoutMs = readIntEnv("INDEX_TTS2_JOB_TIMEOUT_MS", 900_000, 60_000, 3_600_000);
  const requestTimeoutMs = readIntEnv("INDEX_TTS2_REQUEST_TIMEOUT_MS", 30_000, 5_000, 120_000);
  const syncTimeoutMs = readIntEnv("INDEX_TTS2_TIMEOUT_MS", 120_000, 30_000, 600_000);
  const pollMs = readIntEnv("INDEX_TTS2_POLL_MS", 3_000, 1_000, 15_000);
  const asyncEnabled = process.env.INDEX_TTS2_ASYNC?.trim() !== "0";
  const voice = process.env.INDEX_TTS2_VOICE?.trim() || "常用";

  if (pick === "mock") return new MockTtsProvider();
  if (pick === "say") return new SayTtsProvider(process.env.SAY_VOICE?.trim() || "Tingting");
  if (pick === "index-tts2" && url) return new IndexTts2Provider(url, jobTimeoutMs, voice, requestTimeoutMs, syncTimeoutMs, pollMs, asyncEnabled);
  if (pick === "replicate" && token) return new ReplicateTtsProvider(token);

  // 自动：远程/本地 index-tts2 worker > Replicate > macOS say（真人声）> Mock
  if (url) return new IndexTts2Provider(url, jobTimeoutMs, voice, requestTimeoutMs, syncTimeoutMs, pollMs, asyncEnabled);
  if (token) return new ReplicateTtsProvider(token);
  if (process.platform === "darwin") return new SayTtsProvider(process.env.SAY_VOICE?.trim() || "Tingting");
  return new MockTtsProvider();
}

export { probeDuration };
