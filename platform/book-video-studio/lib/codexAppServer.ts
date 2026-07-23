import { spawn } from "node:child_process";
import readline from "node:readline";
import { resolveCodexPathOverride, resolveCodexWorkingDirectory } from "./codexRuntime";

type JsonObject = Record<string, any>;

export type CodexTaskEvent =
  | { type: "thread.started"; thread_id: string; raw: JsonObject }
  | { type: "turn.started"; raw: JsonObject }
  | { type: "item.started"; item: JsonObject; raw: JsonObject }
  | { type: "item.completed"; item: JsonObject; raw: JsonObject }
  | { type: "turn.completed"; status: string; error: string | null; raw: JsonObject }
  | { type: "error"; message: string; raw: JsonObject };

type RunVisibleCodexTaskInput = {
  title: string;
  prompt: string;
  projectRoot: string;
  existingThreadId?: string | null;
  onEvent: (event: CodexTaskEvent) => void | Promise<void>;
};

function messageFromError(value: unknown) {
  if (!value) return "Codex 任务执行失败";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "message" in value) {
    return String((value as { message?: unknown }).message || "Codex 任务执行失败");
  }
  return JSON.stringify(value);
}

export async function runVisibleCodexTask(input: RunVisibleCodexTaskInput) {
  const executable = resolveCodexPathOverride();
  if (!executable) {
    throw new Error("未找到 Codex CLI，请配置 BOOK_VIDEO_CODEX_PATH");
  }
  const env = { ...process.env } as NodeJS.ProcessEnv;
  delete env.CODEX_THREAD_ID;
  const child = spawn(executable, ["app-server"], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = readline.createInterface({ input: child.stdout });
  let requestId = 0;
  let settled = false;
  let turnCompleted: (() => void) | null = null;
  let turnFailed: ((error: Error) => void) | null = null;
  const pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  const stderr: Buffer[] = [];

  const finishPending = (error: Error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };

  const request = (method: string, params: JsonObject, timeoutMs = 60_000) =>
    new Promise<any>((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex app-server 请求超时：${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });

  const notify = (method: string, params: JsonObject) => {
    child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  };

  const completion = new Promise<void>((resolve, reject) => {
    turnCompleted = resolve;
    turnFailed = reject;
  });

  lines.on("line", (line) => {
    let message: JsonObject;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message.id === "number" && pending.has(message.id)) {
      const current = pending.get(message.id)!;
      pending.delete(message.id);
      clearTimeout(current.timer);
      if (message.error) current.reject(new Error(messageFromError(message.error)));
      else current.resolve(message.result);
      return;
    }

    const params = message.params || {};
    let event: CodexTaskEvent | null = null;
    if (message.method === "turn/started") {
      event = { type: "turn.started", raw: message };
    } else if (message.method === "item/started") {
      event = { type: "item.started", item: params.item || {}, raw: message };
    } else if (message.method === "item/completed") {
      event = { type: "item.completed", item: params.item || {}, raw: message };
    } else if (message.method === "error") {
      event = { type: "error", message: messageFromError(params.error || params), raw: message };
    } else if (message.method === "turn/completed") {
      const status = String(params.turn?.status || "completed");
      const error = params.turn?.error ? messageFromError(params.turn.error) : null;
      event = { type: "turn.completed", status, error, raw: message };
      if (status === "failed") turnFailed?.(new Error(error || "Codex 任务执行失败"));
      else turnCompleted?.();
    }
    if (event) {
      void Promise.resolve(input.onEvent(event)).catch((error) => turnFailed?.(error));
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.reduce((sum, item) => sum + item.length, 0) < 100_000) stderr.push(chunk);
  });
  child.once("error", (error) => {
    finishPending(error);
    turnFailed?.(error);
  });
  child.once("exit", (code, signal) => {
    if (settled) return;
    const detail = Buffer.concat(stderr).toString("utf8").slice(-4_000);
    const error = new Error(
      `Codex app-server 提前退出（${signal ? `signal ${signal}` : `code ${code ?? 1}`}）${detail ? `：${detail}` : ""}`,
    );
    finishPending(error);
    turnFailed?.(error);
  });

  try {
    await request("initialize", {
      clientInfo: {
        name: "codex_vscode",
        title: "Book Video Studio",
        version: "1.5.0",
      },
      capabilities: { experimentalApi: true },
    });
    notify("initialized", {});
    const workingDirectory = resolveCodexWorkingDirectory(input.projectRoot);
    const threadResponse = input.existingThreadId
      ? await request("thread/resume", {
          threadId: input.existingThreadId,
          cwd: workingDirectory,
          approvalPolicy: "never",
          sandbox: "workspace-write",
        })
      : await request("thread/start", {
          cwd: workingDirectory,
          approvalPolicy: "never",
          sandbox: "workspace-write",
          ephemeral: false,
        });
    const threadId = String(threadResponse.thread?.id || input.existingThreadId || "");
    if (!threadId) throw new Error("Codex app-server 未返回 threadId");
    await request("thread/name/set", { threadId, name: input.title });
    await input.onEvent({ type: "thread.started", thread_id: threadId, raw: threadResponse });
    await request("turn/start", {
      threadId,
      input: [{ type: "text", text: input.prompt }],
    });
    await completion;
    settled = true;
    return { threadId };
  } finally {
    settled = true;
    finishPending(new Error("Codex app-server 已关闭"));
    lines.close();
    if (!child.killed) child.kill();
  }
}
