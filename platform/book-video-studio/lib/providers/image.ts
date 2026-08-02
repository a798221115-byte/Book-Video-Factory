// 配图 Provider：gpt-image-2（OpenAI 兼容 /images/generations，返回 b64_json）/ Mock。
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface ImageProvider {
  readonly name: string;
  // 生成一张图，写到 outPath（png）。size 形如 "1024x1024"
  generate(prompt: string, outPath: string, opts?: ImageGenerateOptions): Promise<{ path: string; provider?: string }>;
  edit?(prompt: string, inputPath: string, outPath: string, opts?: ImageGenerateOptions): Promise<{ path: string; provider?: string }>;
}

export type ImageGenerateProgress = {
  stage: "attempt" | "waiting" | "response" | "download" | "retry" | "fallback";
  attempt: number;
  maxAttempts: number;
  provider?: string;
  elapsedMs?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  message?: string;
};

export type ImageErrorKind = "timeout" | "network" | "http" | "empty" | "transient" | "unknown";

export type ImageChannelError = {
  provider: string;
  kind: ImageErrorKind;
  message: string;
  status?: number;
};

export class ImageProviderError extends Error {
  readonly provider?: string;
  readonly kind: ImageErrorKind;
  readonly status?: number;
  readonly channelErrors?: ImageChannelError[];

  constructor(message: string, options: {
    provider?: string;
    kind?: ImageErrorKind;
    status?: number;
    channelErrors?: ImageChannelError[];
  } = {}) {
    super(message);
    this.name = "ImageProviderError";
    this.provider = options.provider;
    this.kind = options.kind || "unknown";
    this.status = options.status;
    this.channelErrors = options.channelErrors;
  }
}

export type ImageGenerateOptions = {
  size?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  onProgress?: (event: ImageGenerateProgress) => void;
};

function normalizeImageError(error: unknown, fallbackProvider: string): ImageChannelError {
  if (error instanceof ImageProviderError) {
    return {
      provider: error.provider || fallbackProvider,
      kind: error.kind,
      message: error.message,
      status: error.status,
    };
  }
  return {
    provider: fallbackProvider,
    kind: "unknown",
    message: String((error as any)?.message || error || "unknown image error"),
  };
}

function toBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function notify(opts: ImageGenerateOptions | undefined, event: ImageGenerateProgress) {
  try { opts?.onProgress?.(event); } catch { /* progress callbacks are best-effort */ }
}

const DEFAULT_TIMEOUT_MS = toBoundedInt(process.env.IMAGE_TIMEOUT_MS, 240_000, 30_000, 600_000);
const DEFAULT_MAX_ATTEMPTS = toBoundedInt(process.env.IMAGE_MAX_ATTEMPTS, 3, 1, 3);
const WAITING_PROGRESS_INTERVAL_MS = 15_000;
const DEFAULT_GPT_IMAGE2_KIT_FILE = "E:/BaiduNetdiskWorkspace/电脑其他文件同步/视频号/配置/GPTImage2.txt";

function readGptImage2Kit(): { apiKey: string; baseUrl?: string } {
  const kitPath = process.env.GPT_IMAGE2_KIT_FILE?.trim() || DEFAULT_GPT_IMAGE2_KIT_FILE;
  if (!fs.existsSync(kitPath)) {
    throw new ImageProviderError(`GPT Image 2 API kit 不存在：${kitPath}`, {
      provider: "gpt-image-2-api-kit",
      kind: "unknown",
    });
  }
  const raw = fs.readFileSync(kitPath, "utf8").replace(/^\uFEFF/, "");
  const key = raw.match(/sk-[^\s"']+/)?.[0];
  if (!key) {
    throw new ImageProviderError(`GPT Image 2 API kit 中未找到 sk- 开头的 API Key：${kitPath}`, {
      provider: "gpt-image-2-api-kit",
      kind: "unknown",
    });
  }
  const baseUrl = raw.match(/https?:\/\/[^\s"']+/)?.[0]?.replace(/\/$/, "");
  return { apiKey: key, baseUrl };
}

function normalizeApiBaseUrl(value: string) {
  const baseUrl = value.replace(/\/$/, "");
  return /\/v1$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1`;
}

function isApiMartBaseUrl(baseUrl: string) {
  try { return new URL(baseUrl).hostname.toLowerCase() === "api.apimart.ai"; }
  catch { return false; }
}

function apiMartSize(size: string | undefined) {
  if (!size || size === "1024x1792" || size === "1080x1920") return "9:16";
  return /^\d+:\d+$/.test(size) ? size : "9:16";
}

// gpt-image-2（中转站偶发超时，默认最多重试 1 次；可用 IMAGE_MAX_ATTEMPTS 覆盖到 1-3）
class GptImageProvider implements ImageProvider {
  readonly name: string;
  constructor(
    private apiKey: string,
    private baseUrl: string,
    private model: string,
    name?: string,
  ) {
    this.name = name || model || "gpt-image";
  }
  async generate(prompt: string, outPath: string, opts?: ImageGenerateOptions): Promise<{ path: string; provider?: string }> {
    let lastErr: any;
    const maxAttempts = toBoundedInt(opts?.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 3);
    const timeoutMs = toBoundedInt(opts?.timeoutMs, DEFAULT_TIMEOUT_MS, 30_000, 600_000);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      notify(opts, { stage: "attempt", attempt, maxAttempts, timeoutMs, provider: this.name });
      try { return await this.once(prompt, outPath, opts, attempt, maxAttempts, timeoutMs); }
      catch (e: any) {
        lastErr = e;
        const msg = String(e?.message || e);
        const rateLimited = /\b429\b|rate_limit|rate limit|no available channel|distributor/i.test(msg);
        const transient = rateLimited || /\b5\d\d\b|do_request_failed|upstream|timeout|ETIMEDOUT|ECONNRESET|fetch failed|aborted/i.test(msg);
        if (!transient || attempt === maxAttempts) throw e;
        const retryDelayMs = rateLimited
          ? Math.min(180_000, 60_000 * attempt)
          : Math.min(10_000, 2000 * 2 ** (attempt - 1));
        notify(opts, { stage: "retry", attempt, maxAttempts, timeoutMs, retryDelayMs, provider: this.name, message: msg.slice(0, 160) });
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
    throw lastErr;
  }
  async edit(prompt: string, inputPath: string, outPath: string, opts?: ImageGenerateOptions): Promise<{ path: string; provider?: string }> {
    if (!fs.existsSync(inputPath)) {
      throw new ImageProviderError(`编辑输入图不存在：${inputPath}`, { provider: this.name, kind: "unknown" });
    }
    let lastErr: unknown;
    const maxAttempts = toBoundedInt(opts?.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 3);
    const timeoutMs = toBoundedInt(opts?.timeoutMs, DEFAULT_TIMEOUT_MS, 30_000, 600_000);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      notify(opts, { stage: "attempt", attempt, maxAttempts, timeoutMs, provider: this.name });
      try {
        if (isApiMartBaseUrl(this.baseUrl)) {
          return await this.apiMartOnce(prompt, outPath, inputPath, opts, attempt, maxAttempts, timeoutMs);
        }
        return await this.editOnce(prompt, inputPath, outPath, opts, attempt, maxAttempts, timeoutMs);
      } catch (error: any) {
        lastErr = error;
        const message = String(error?.message || error);
        const transient = /\b429\b|rate_limit|rate limit|\b5\d\d\b|upstream|timeout|ETIMEDOUT|ECONNRESET|fetch failed|aborted/i.test(message);
        if (!transient || attempt === maxAttempts) throw error;
        const retryDelayMs = /\b429\b|rate_limit|rate limit/i.test(message)
          ? Math.min(180_000, 60_000 * attempt)
          : Math.min(10_000, 2000 * 2 ** (attempt - 1));
        notify(opts, { stage: "retry", attempt, maxAttempts, timeoutMs, retryDelayMs, provider: this.name, message: message.slice(0, 160) });
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
    throw lastErr;
  }
  private async editOnce(
    prompt: string,
    inputPath: string,
    outPath: string,
    opts: ImageGenerateOptions | undefined,
    attempt: number,
    maxAttempts: number,
    timeoutMs: number,
  ): Promise<{ path: string; provider?: string }> {
    const ctrl = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const heartbeat = setInterval(() => notify(opts, {
      stage: "waiting", attempt, maxAttempts, timeoutMs, provider: this.name, elapsedMs: Date.now() - startedAt,
    }), WAITING_PROGRESS_INTERVAL_MS);
    try {
      const bytes = fs.readFileSync(inputPath);
      const extension = pathExtension(inputPath);
      const form = new FormData();
      form.append("model", this.model);
      form.append("prompt", prompt);
      form.append("size", opts?.size || "1024x1024");
      form.append("image", new Blob([bytes], { type: extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png" }), `input${extension || ".png"}`);
      const resp = await fetch(`${this.baseUrl}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: ctrl.signal,
      }).catch((error) => {
        throw new ImageProviderError(
          ctrl.signal.aborted ? `gpt-image-2 edit timeout after ${Math.round(timeoutMs / 1000)}s` : String(error?.message || error || "fetch failed"),
          { provider: this.name, kind: ctrl.signal.aborted ? "timeout" : "network" },
        );
      });
      notify(opts, { stage: "response", attempt, maxAttempts, timeoutMs, provider: this.name, elapsedMs: Date.now() - startedAt, message: String(resp.status) });
      if (!resp.ok) {
        throw new ImageProviderError(`gpt-image-2 edit ${resp.status}: ${(await resp.text()).slice(0, 300)}`, {
          provider: this.name, kind: "http", status: resp.status,
        });
      }
      await writeImageResponse(resp, outPath, ctrl.signal, opts, attempt, maxAttempts, timeoutMs, this.name, startedAt);
      return { path: outPath, provider: this.name };
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timer);
    }
  }
  private async once(
    prompt: string,
    outPath: string,
    opts: ImageGenerateOptions | undefined,
    attempt: number,
    maxAttempts: number,
    timeoutMs: number,
  ): Promise<{ path: string; provider?: string }> {
    if (isApiMartBaseUrl(this.baseUrl)) {
      return this.apiMartOnce(prompt, outPath, undefined, opts, attempt, maxAttempts, timeoutMs);
    }
    const ctrl = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const heartbeat = setInterval(() => {
      notify(opts, {
        stage: "waiting",
        attempt,
        maxAttempts,
        timeoutMs,
        provider: this.name,
        elapsedMs: Date.now() - startedAt,
      });
    }, WAITING_PROGRESS_INTERVAL_MS);
    try {
      const resp = await fetch(`${this.baseUrl}/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, prompt, size: opts?.size || "1024x1024" }),
        signal: ctrl.signal,
      }).catch((e) => {
        if (ctrl.signal.aborted) {
          throw new ImageProviderError(`gpt-image-2 timeout after ${Math.round(timeoutMs / 1000)}s`, {
            provider: this.name,
            kind: "timeout",
          });
        }
        throw new ImageProviderError(String(e?.message || e || "fetch failed"), {
          provider: this.name,
          kind: "network",
        });
      });
      notify(opts, {
        stage: "response",
        attempt,
        maxAttempts,
        timeoutMs,
        provider: this.name,
        elapsedMs: Date.now() - startedAt,
        message: String(resp.status),
      });
      if (!resp.ok) {
        throw new ImageProviderError(`gpt-image-2 ${resp.status}: ${(await resp.text()).slice(0, 300)}`, {
          provider: this.name,
          kind: "http",
          status: resp.status,
        });
      }
      const json: any = await resp.json();
      const item = json?.data?.[0] || {};
      if (item.b64_json) {
        fs.writeFileSync(outPath, Buffer.from(item.b64_json, "base64"));
      } else if (item.url) {
        notify(opts, {
          stage: "download",
          attempt,
          maxAttempts,
          timeoutMs,
          provider: this.name,
          elapsedMs: Date.now() - startedAt,
        });
        const img = await fetch(item.url, { signal: ctrl.signal }).catch((e) => {
          if (ctrl.signal.aborted) {
            throw new ImageProviderError(`gpt-image-2 image download timeout after ${Math.round(timeoutMs / 1000)}s`, {
              provider: this.name,
              kind: "timeout",
            });
          }
          throw new ImageProviderError(String(e?.message || e || "image download failed"), {
            provider: this.name,
            kind: "network",
          });
        });
        fs.writeFileSync(outPath, Buffer.from(await img.arrayBuffer()));
      } else {
        throw new ImageProviderError("生图响应无 b64_json/url", {
          provider: this.name,
          kind: "empty",
        });
      }
      return { path: outPath, provider: this.name };
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timer);
    }
  }

  private async apiMartOnce(
    prompt: string,
    outPath: string,
    inputPath: string | undefined,
    opts: ImageGenerateOptions | undefined,
    attempt: number,
    maxAttempts: number,
    timeoutMs: number,
  ): Promise<{ path: string; provider?: string }> {
    const ctrl = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const heartbeat = setInterval(() => notify(opts, {
      stage: "waiting", attempt, maxAttempts, timeoutMs, provider: this.name, elapsedMs: Date.now() - startedAt,
      message: "APIMart 异步任务处理中",
    }), WAITING_PROGRESS_INTERVAL_MS);
    try {
      const body: Record<string, unknown> = {
        model: this.model,
        prompt,
        n: 1,
        size: apiMartSize(opts?.size),
        resolution: process.env.GPT_IMAGE2_RESOLUTION?.trim() || "1k",
      };
      if (inputPath) {
        const extension = pathExtension(inputPath);
        const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
        body.image_urls = [`data:${mime};base64,${fs.readFileSync(inputPath).toString("base64")}`];
      }
      const submit = await fetch(`${this.baseUrl}/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      notify(opts, { stage: "response", attempt, maxAttempts, timeoutMs, provider: this.name, elapsedMs: Date.now() - startedAt, message: String(submit.status) });
      if (!submit.ok) {
        throw new ImageProviderError(`APIMart gpt-image-2 ${submit.status}: ${(await submit.text()).slice(0, 300)}`, {
          provider: this.name, kind: "http", status: submit.status,
        });
      }
      const submitted: any = await submit.json();
      const taskId = submitted?.data?.[0]?.task_id;
      if (!taskId) throw new ImageProviderError("APIMart 生图响应无 task_id", { provider: this.name, kind: "empty" });
      let task: any;
      while (!ctrl.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const poll = await fetch(`${this.baseUrl}/tasks/${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: ctrl.signal,
        }).catch(() => {
          throw new ImageProviderError("APIMart 已提交生图任务，但轮询网络异常；为避免重复计费未自动重提", {
            provider: this.name, kind: "unknown",
          });
        });
        if (!poll.ok) {
          throw new ImageProviderError(`APIMart task ${poll.status}: ${(await poll.text()).slice(0, 300)}`, {
            provider: this.name, kind: "http", status: poll.status,
          });
        }
        task = await poll.json();
        const status = String(task?.data?.status || "");
        notify(opts, {
          stage: "waiting", attempt, maxAttempts, timeoutMs, provider: this.name,
          elapsedMs: Date.now() - startedAt,
          message: `${status || "processing"} ${Number(task?.data?.progress || 0)}%`,
        });
        if (status === "completed") break;
        if (["failed", "error", "cancelled"].includes(status)) {
          throw new ImageProviderError(`APIMart 生图任务失败：${status}`, { provider: this.name, kind: "unknown" });
        }
      }
      if (ctrl.signal.aborted) {
        throw new ImageProviderError("APIMart 已提交生图任务，但本次轮询未完成", { provider: this.name, kind: "unknown" });
      }
      const imageUrl = task?.data?.result?.images?.[0]?.url?.[0];
      if (!imageUrl) throw new ImageProviderError("APIMart 完成响应无图片 URL", { provider: this.name, kind: "empty" });
      notify(opts, { stage: "download", attempt, maxAttempts, timeoutMs, provider: this.name, elapsedMs: Date.now() - startedAt });
      const image = await fetch(imageUrl, { signal: ctrl.signal });
      if (!image.ok) throw new ImageProviderError(`APIMart image download ${image.status}`, { provider: this.name, kind: "http", status: image.status });
      fs.mkdirSync(requirePathDir(outPath), { recursive: true });
      fs.writeFileSync(outPath, Buffer.from(await image.arrayBuffer()));
      return { path: outPath, provider: this.name };
    } catch (error) {
      if (ctrl.signal.aborted && !(error instanceof ImageProviderError)) {
        throw new ImageProviderError("APIMart 已提交生图任务，但本次轮询未完成", { provider: this.name, kind: "unknown" });
      }
      throw error;
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timer);
    }
  }
}

function pathExtension(filePath: string) {
  const match = /\.[^.\\/]+$/.exec(filePath);
  return match?.[0]?.toLowerCase() || ".png";
}

async function writeImageResponse(
  resp: Response,
  outPath: string,
  signal: AbortSignal,
  opts: ImageGenerateOptions | undefined,
  attempt: number,
  maxAttempts: number,
  timeoutMs: number,
  provider: string,
  startedAt: number,
) {
  const json: any = await resp.json();
  const item = json?.data?.[0] || {};
  fs.mkdirSync(requirePathDir(outPath), { recursive: true });
  if (item.b64_json) {
    fs.writeFileSync(outPath, Buffer.from(item.b64_json, "base64"));
    return;
  }
  if (item.url) {
    notify(opts, { stage: "download", attempt, maxAttempts, timeoutMs, provider, elapsedMs: Date.now() - startedAt });
    const image = await fetch(item.url, { signal });
    if (!image.ok) throw new ImageProviderError(`image download ${image.status}`, { provider, kind: "http", status: image.status });
    fs.writeFileSync(outPath, Buffer.from(await image.arrayBuffer()));
    return;
  }
  throw new ImageProviderError("生图响应无 b64_json/url", { provider, kind: "empty" });
}

function requirePathDir(filePath: string) {
  const normalized = filePath.replace(/[\\/][^\\/]+$/, "");
  return normalized || ".";
}

// Mock：用 ffmpeg 画一张带网格的纯色占位图（让链路跑通，不花钱）
class MockImageProvider implements ImageProvider {
  readonly name = "mock-image";
  async generate(_prompt: string, outPath: string, opts?: ImageGenerateOptions): Promise<{ path: string; provider?: string }> {
    const size = opts?.size || "1024x1024";
    notify(opts, { stage: "attempt", attempt: 1, maxAttempts: 1, timeoutMs: 0, provider: this.name });
    await execFileP("ffmpeg", [
      "-y", "-nostdin", "-f", "lavfi", "-i", `color=c=#2b3a4a:s=${size}`,
      "-frames:v", "1", outPath,
    ]);
    return { path: outPath, provider: this.name };
  }
}

type ImageChannelConfig = {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type PublicImageChannelConfig = {
  name: string;
  baseUrl: string;
  model: string;
  keyHint: string;
};

class MultiImageProvider implements ImageProvider {
  readonly name: string;
  private nextIndex = 0;

  constructor(private providers: GptImageProvider[]) {
    this.name = `multi-image(${providers.map((provider) => provider.name).join(",")})`;
  }

  get channelCount() {
    return this.providers.length;
  }

  async generate(prompt: string, outPath: string, opts?: ImageGenerateOptions): Promise<{ path: string; provider?: string }> {
    const startIndex = this.nextIndex++ % this.providers.length;
    const channelErrors: ImageChannelError[] = [];
    for (let offset = 0; offset < this.providers.length; offset++) {
      const provider = this.providers[(startIndex + offset) % this.providers.length];
      if (offset > 0) {
        notify(opts, {
          stage: "fallback",
          attempt: offset + 1,
          maxAttempts: this.providers.length,
          provider: provider.name,
          message: channelErrors[channelErrors.length - 1]?.message.slice(0, 160),
        });
      }
      try {
        return await provider.generate(prompt, outPath, { ...opts, maxAttempts: 1 });
      } catch (error) {
        channelErrors.push(normalizeImageError(error, provider.name));
      }
    }
    const hardError = channelErrors.find((error) => error.kind === "http" || error.kind === "empty");
    const finalError = hardError || channelErrors[channelErrors.length - 1];
    throw new ImageProviderError(finalError?.message || "all image channels failed", {
      provider: finalError?.provider,
      kind: hardError ? hardError.kind : "transient",
      status: finalError?.status,
      channelErrors,
    });
  }
}

function parseImageChannels(raw: string | undefined): ImageChannelConfig[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const [name, baseUrl, apiKey, model] = entry.split("|").map((part) => part.trim());
      if (!baseUrl || !apiKey) return null;
      return {
        name: name || `image-${index + 1}`,
        baseUrl,
        apiKey,
        model: model || "gpt-image-2",
      };
    })
    .filter((channel): channel is ImageChannelConfig => !!channel);
}

function configuredImageChannels(): ImageChannelConfig[] {
  const kitPath = process.env.GPT_IMAGE2_KIT_FILE?.trim() || DEFAULT_GPT_IMAGE2_KIT_FILE;
  // Image generation is optional during server startup and Next.js route
  // collection. Keep the channel list empty until a real kit is configured;
  // getImage() will still fail closed when generation is actually requested.
  if (!fs.existsSync(kitPath)) return [];
  const kit = readGptImage2Kit();
  return [{
    name: "gpt-image-2-api-kit",
    apiKey: kit.apiKey,
    baseUrl: normalizeApiBaseUrl(process.env.GPT_IMAGE2_BASE_URL?.trim() || kit.baseUrl || "https://api.openai.com/v1"),
    model: process.env.GPT_IMAGE2_MODEL?.trim() || "gpt-image-2",
  }];
}

export function getConfiguredImageChannels(): PublicImageChannelConfig[] {
  return configuredImageChannels().map((channel) => ({
    name: channel.name,
    baseUrl: channel.baseUrl,
    model: channel.model,
    keyHint: channel.apiKey ? "已配置（已隐藏）" : "未配置",
  }));
}

export async function probeImageChannel(channel: PublicImageChannelConfig, timeoutMs = 8_000) {
  const ctrl = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const configured = configuredImageChannels().find((item) => (
      item.name === channel.name && item.baseUrl === channel.baseUrl && item.model === channel.model
    ));
    if (!configured) throw new Error("通道配置不存在");
    const resp = await fetch(`${configured.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${configured.apiKey}` },
      signal: ctrl.signal,
    });
    const text = await resp.text().catch(() => "");
    return {
      name: configured.name,
      baseUrl: configured.baseUrl,
      model: configured.model,
      ok: resp.ok,
      status: resp.status,
      latencyMs: Date.now() - startedAt,
      message: resp.ok ? "models 可访问" : text.slice(0, 180) || `${resp.status} ${resp.statusText}`,
    };
  } catch (error: any) {
    return {
      name: channel.name,
      baseUrl: channel.baseUrl,
      model: channel.model,
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      message: ctrl.signal.aborted ? `健康检查超时 ${Math.round(timeoutMs / 1000)}s` : String(error?.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function getImageChannelCount() {
  return configuredImageChannels().length || 1;
}

export function getImage(): ImageProvider {
  let channels: ImageChannelConfig[];
  try {
    channels = configuredImageChannels();
  } catch (error) {
    if (process.env.ALLOW_MOCK_PROVIDERS === "1") return new MockImageProvider();
    throw error;
  }
  if (channels.length === 1) {
    const channel = channels[0];
    return new GptImageProvider(channel.apiKey, channel.baseUrl, channel.model, channel.name);
  }
  if (channels.length > 1) {
    return new MultiImageProvider(
      channels.map((channel) => new GptImageProvider(channel.apiKey, channel.baseUrl, channel.model, channel.name)),
    );
  }
  throw new ImageProviderError("GPT Image 2 API kit 未配置", { provider: "gpt-image-2-api-kit", kind: "unknown" });
}
