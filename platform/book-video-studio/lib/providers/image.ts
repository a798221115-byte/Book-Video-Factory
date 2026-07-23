// 配图 Provider：gpt-image-2（OpenAI 兼容 /images/generations，返回 b64_json）/ Mock。
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface ImageProvider {
  readonly name: string;
  // 生成一张图，写到 outPath（png）。size 形如 "1024x1024"
  generate(prompt: string, outPath: string, opts?: ImageGenerateOptions): Promise<{ path: string; provider?: string }>;
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
  private async once(
    prompt: string,
    outPath: string,
    opts: ImageGenerateOptions | undefined,
    attempt: number,
    maxAttempts: number,
    timeoutMs: number,
  ): Promise<{ path: string; provider?: string }> {
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
        model: model || process.env.IMAGE_MODEL?.trim() || "gpt-image-1",
      };
    })
    .filter((channel): channel is ImageChannelConfig => !!channel);
}

function configuredImageChannels(): ImageChannelConfig[] {
  const channels = parseImageChannels(process.env.IMAGE_CHANNELS);
  const key = process.env.IMAGE_API_KEY?.trim();
  const primaryDisabled = process.env.IMAGE_PRIMARY_DISABLED === "1";
  if (key && !primaryDisabled) {
    channels.unshift({
      name: process.env.IMAGE_CHANNEL_NAME?.trim() || "primary",
      apiKey: key,
      baseUrl: process.env.IMAGE_BASE_URL?.trim() || "https://api.openai.com/v1",
      model: process.env.IMAGE_MODEL?.trim() || "gpt-image-1",
    });
  }
  const seen = new Set<string>();
  return channels.filter((channel) => {
    const dedupKey = `${channel.baseUrl}|${channel.apiKey}|${channel.model}`;
    if (seen.has(dedupKey)) return false;
    seen.add(dedupKey);
    return true;
  });
}

export function getConfiguredImageChannels(): PublicImageChannelConfig[] {
  return configuredImageChannels().map((channel) => ({
    name: channel.name,
    baseUrl: channel.baseUrl,
    model: channel.model,
    keyHint: channel.apiKey.length > 10
      ? `${channel.apiKey.slice(0, 6)}...${channel.apiKey.slice(-4)}`
      : channel.apiKey ? "已配置" : "未配置",
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
  const channels = configuredImageChannels();
  if (channels.length === 1) {
    const channel = channels[0];
    return new GptImageProvider(channel.apiKey, channel.baseUrl, channel.model, channel.name);
  }
  if (channels.length > 1) {
    return new MultiImageProvider(
      channels.map((channel) => new GptImageProvider(channel.apiKey, channel.baseUrl, channel.model, channel.name)),
    );
  }
  return new MockImageProvider();
}
