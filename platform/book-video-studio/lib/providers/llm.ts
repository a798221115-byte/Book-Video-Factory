// 统一 LLM Provider（OpenAI 兼容 chat completions；支持流式；无 key 时 Mock）
import fs from "node:fs";

export interface ChatOpts {
  system: string;
  user: string;
  temperature?: number;
  json?: boolean;
  model?: string;
}

export interface LLMProvider {
  readonly name: string;
  chat(opts: ChatOpts): Promise<string>;
}

class OpenAICompatProvider implements LLMProvider {
  constructor(
    public readonly name: string,
    private apiKey: string,
    private baseUrl: string,
    private defaultModel: string,
    private forceStream = false, // 某些中转节点(如 deepseek-v4-flash)只接受流式
    private timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 90_000,
  ) {}

  async chat(opts: ChatOpts): Promise<string> {
    // 中转站偶发 5xx/超时/空响应，重试 3 次指数退避（4xx 等非瞬时错误直接抛）
    let lastErr: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const out = await this.once(opts);
        if (out && out.trim()) return out;
        lastErr = new Error(`${this.name} 返回空内容`);
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message || e);
        const transient = /\b5\d\d\b|timeout|aborted|ECONNRESET|ECONNREFUSED|fetch failed|do_request_failed|网络|返回空/i.test(msg);
        if (!transient || attempt === 2) throw e;
      }
      await new Promise((r) => setTimeout(r, 1200 * 2 ** attempt));
    }
    throw lastErr;
  }

  private async once(opts: ChatOpts): Promise<string> {
    const stream = this.forceStream;
    // 该网关 json_object 模式要求【user 消息】里含小写 "json"（不看 system），否则 400
    let user = opts.user;
    if (opts.json && !/json/.test(user)) {
      user += "\n（仅输出 json，不要任何额外文字。）";
    }
    const body: any = {
      model: opts.model || this.defaultModel,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: user },
      ],
      temperature: opts.temperature ?? 0.7,
      stream,
    };
    if (opts.json) body.response_format = { type: "json_object" };

    // 超时保护：长文本生成留足余量，避免挂起拖死整个步骤
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error(`${this.name} 调用超时(${this.timeoutMs}ms)`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) throw new Error(`${this.name} ${resp.status}: ${(await resp.text()).slice(0, 300)}`);

    if (!stream) {
      const json: any = await resp.json();
      return json?.choices?.[0]?.message?.content ?? "";
    }
    // 解析 SSE 流，拼接 delta.content
    const text = await resp.text();
    let out = "";
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") break;
      try {
        const j = JSON.parse(data);
        const piece = j?.choices?.[0]?.delta?.content;
        if (piece) out += piece;
      } catch { /* 忽略非 JSON 行 */ }
    }
    return out;
  }
}

class MockLLMProvider implements LLMProvider {
  readonly name = "mock";
  async chat(opts: ChatOpts): Promise<string> {
    await new Promise((r) => setTimeout(r, 600));
    const s = opts.system;
    if (opts.json && s.includes("信息抽取")) {
      return JSON.stringify({ book_title: "超越百岁", book_author: "［美］彼得·阿提亚", confidence: 0.82, evidence: "逐字稿提到作者彼得阿提亚及衰老与肌肉主题" });
    }
    if (opts.json && s.includes("拆段")) {
      const text = opts.user.split("拆段：")[1]?.trim() || opts.user;
      const segs = text.split(/(?<=[。！？])/).filter((x) => x.trim());
      return JSON.stringify({ segments: segs.length ? segs : [text] });
    }
    if (s.includes("清洗")) {
      const text = opts.user.split("修复清洗后的正文：")[1]?.trim() || opts.user;
      return "[MOCK清洗] " + text.replace(/记得点赞收藏关注我[，。].*?$/g, "").replace(/喜欢的话主页有更多内容[。]?/g, "").replace(/大家好[，,]?今天给大家分享一本书[，,]?/g, "").trim();
    }
    if (s.includes("改写")) {
      const text = opts.user.split("待改写正文：")[1]?.trim() || opts.user;
      return "[MOCK改写] " + text;
    }
    return "[MOCK] " + opts.user.slice(0, 50);
  }
}

class FallbackLLMProvider implements LLMProvider {
  readonly name: string;
  constructor(private chain: LLMProvider[]) {
    this.name = chain.map((p) => p.name).join(">");
  }
  async chat(opts: ChatOpts): Promise<string> {
    let lastErr: any;
    for (let i = 0; i < this.chain.length; i++) {
      const p = this.chain[i];
      try {
        const out = await p.chat(opts);
        if (out && out.trim()) return out;
        lastErr = new Error(`${p.name} 返回空内容`);
      } catch (e: any) {
        lastErr = e;
      }
      if (i < this.chain.length - 1) {
        console.warn(`[llm] ${p.name} 失败，切换下一个兜底:`, String(lastErr?.message || lastErr).slice(0, 160));
      }
    }
    throw new Error(`所有 LLM 通道均失败: ${String(lastErr?.message || lastErr).slice(0, 200)}`);
  }
}

function getDeepSeekConfig() {
  const config = {
    apiKey: process.env.DEEPSEEK_API_KEY?.trim() || "",
    baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
  };
  const configFile = process.env.DEEPSEEK_CONFIG_FILE?.trim();
  if (!configFile || !fs.existsSync(configFile)) return config;

  const values = new Map<string, string>();
  for (const line of fs.readFileSync(configFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    values.set(
      trimmed.slice(0, separator).trim(),
      trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, ""),
    );
  }
  return {
    apiKey: values.get("DEEPSEEK_API_KEY") || config.apiKey,
    baseUrl: values.get("DEEPSEEK_BASE_URL") || config.baseUrl,
    model: values.get("DEEPSEEK_MODEL") || config.model,
  };
}

// 改写/清洗（默认 OpenAI 兼容；中转用 gpt-5.5）
export function getLLM(): LLMProvider {
  const chain: LLMProvider[] = [];
  const key = process.env.OPENAI_API_KEY;
  if (key && key.trim()) {
    chain.push(new OpenAICompatProvider(
      "openai", key.trim(),
      process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      process.env.OPENAI_MODEL || "gpt-4o",
      false,
    ));
  }
  const deepseek = getDeepSeekConfig();
  if (deepseek.apiKey) {
    const model = deepseek.model;
    chain.push(new OpenAICompatProvider(
      "deepseek-fallback", deepseek.apiKey,
      deepseek.baseUrl,
      model,
      model.includes("flash"),
    ));
  }
  if (!chain.length) {
    if (process.env.ALLOW_MOCK_PROVIDERS === "1") return new MockLLMProvider();
    throw new Error("未配置可用 LLM。请配置 OPENAI_API_KEY 或 DEEPSEEK_API_KEY。");
  }
  return chain.length === 1 ? chain[0] : new FallbackLLMProvider(chain);
}

// 逐字稿清洗与语义分段优先使用 DeepSeek；未配置时才回退到通用 LLM。
export function getTranscriptLLM(): LLMProvider {
  const deepseek = getDeepSeekConfig();
  if (deepseek.apiKey) {
    const model = deepseek.model;
    return new OpenAICompatProvider(
      "deepseek-transcript",
      deepseek.apiKey,
      deepseek.baseUrl,
      model,
      model.includes("flash"),
    );
  }
  return getLLM();
}

// 书名识别（DeepSeek deepseek-v4-flash，需流式）
export function getBookLLM(): LLMProvider {
  const deepseek = getDeepSeekConfig();
  if (deepseek.apiKey) {
    const model = deepseek.model;
    const forceStream = model.includes("flash"); // flash 节点只接受流式
    return new OpenAICompatProvider(
      "deepseek", deepseek.apiKey,
      deepseek.baseUrl,
      model, forceStream,
    );
  }
  return getLLM();
}
