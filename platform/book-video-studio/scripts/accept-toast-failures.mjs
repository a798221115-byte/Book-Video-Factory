#!/usr/bin/env node
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(repoRoot, "data", "app.db");
const baseUrl = (process.env.ACCEPT_TOAST_BASE_URL || "http://127.0.0.1:3939").replace(/\/+$/, "");
const chromeBin = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const stepNames = ["extract", "transcribe", "rewrite", "tts", "subtitle", "images", "render"];
const failureBody = Buffer.from(JSON.stringify({ error: "forced toast e2e failure" })).toString("base64");

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (event) => this.handleMessage(event.data));
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    this.ws.send(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 15_000);
    });
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) || [];
    handlers.push(handler);
    this.listeners.set(method, handlers);
  }

  async close() {
    this.ws.close();
  }

  handleMessage(raw) {
    const message = JSON.parse(raw);
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result || {});
      return;
    }
    if (message.method) {
      for (const handler of this.listeners.get(message.method) || []) {
        handler(message).catch?.(() => {});
      }
    }
  }
}

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!fs.existsSync(chromeBin)) throw new Error(`Chrome not found. Set CHROME_BIN. Tried: ${chromeBin}`);

await waitForServer(baseUrl);

const fixture = createFixtureTask();
const chrome = await launchChrome();
let cdp;
try {
  cdp = await Cdp.connect(chrome.wsUrl);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params = {}) => cdp.send(method, params, sessionId);
  await page("Page.enable");
  await page("Runtime.enable");
  await page("Fetch.enable", {
    patterns: [
      { urlPattern: `${baseUrl}/api/tasks/*`, requestStage: "Request" },
    ],
  });
  cdp.on("Fetch.requestPaused", async (event) => {
    if (event.sessionId !== sessionId) return;
    const { requestId, request } = event.params;
    const url = request.url;
    const method = request.method;
    const shouldFail =
      (method === "PATCH" && url === `${baseUrl}/api/tasks/${fixture.taskId}`) ||
      (method === "PATCH" && url === `${baseUrl}/api/tasks/${fixture.taskId}/config`) ||
      (method === "POST" && url.includes(`/api/tasks/${fixture.taskId}/images/`) && url.endsWith("/regenerate"));
    if (shouldFail) {
      await page("Fetch.fulfillRequest", {
        requestId,
        responseCode: 500,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: failureBody,
      }).catch(() => {});
    } else {
      await page("Fetch.continueRequest", { requestId }).catch(() => {});
    }
  });

  await navigate(page, `${baseUrl}/tasks/${fixture.taskId}`);
  await clickButtonText(page, "生成音频");
  await waitForText(page, "保存音频配置失败");
  await clickButtonText(page, "保存声明");
  await waitForText(page, "保存声明失败");
  await clickButtonText(page, "重生成此图");
  await waitForText(page, "单图重生成失败");

  await navigate(page, `${baseUrl}/`);
  await evaluate(page, `
    (() => {
      const row = [...document.querySelectorAll("tr")].find((item) => item.innerText.includes(${JSON.stringify(fixture.title)}));
      if (!row) throw new Error("fixture row not found");
      row.querySelector(".note-pill")?.click();
    })()
  `);
  await waitForExpression(page, `!!document.querySelector('input[aria-label="任务备注"]')`);
  await evaluate(page, `
    (() => {
      const input = document.querySelector('input[aria-label="任务备注"]');
      input.value = "失败 toast 验收";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const row = input.closest("tr");
      const button = [...row.querySelectorAll("button")].find((item) => item.textContent.trim() === "保存");
      if (!button) throw new Error("note save button not found");
      button.click();
    })()
  `);
  await waitForText(page, "备注保存失败");

  await assertNoText(page, [
    "音频配置已保存",
    "声明已保存",
    "单图已重生成",
    "备注已保存",
  ]);

  console.log("OK: failure toast E2E clicks passed for config, statement, single-image regenerate, and notes.");
} finally {
  try { await cdp?.close(); } catch {}
  try {
    chrome.child.kill("TERM");
    await Promise.race([
      new Promise((resolve) => chrome.child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (!chrome.child.killed) chrome.child.kill("KILL");
  } catch {}
  cleanupFixtureTask(fixture.taskId);
  try {
    fs.rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}

function createFixtureTask() {
  const db = new Database(dbPath);
  const now = Date.now();
  const taskId = `toast-e2e-${now}-${crypto.randomBytes(3).toString("hex")}`;
  const title = `Toast failure E2E ${taskId.slice(-6)}`;
  const dir = path.join(repoRoot, "data", "tasks", taskId);
  const imagePath = path.join(dir, "img_0_0.png");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(imagePath, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ));

  db.prepare(`
    INSERT INTO tasks (id, source_url, title, author, keyword, status, created_at, updated_at)
    VALUES (@id, @sourceUrl, @title, @author, @keyword, @status, @createdAt, @updatedAt)
  `).run({
    id: taskId,
    sourceUrl: `toast-e2e://${taskId}`,
    title,
    author: "toast-e2e",
    keyword: "toast",
    status: "done",
    createdAt: now,
    updatedAt: now,
  });

  const insertStep = db.prepare(`
    INSERT INTO steps (id, task_id, name, status, output, progress, started_at, finished_at)
    VALUES (@id, @taskId, @name, @status, @output, @progress, @startedAt, @finishedAt)
  `);
  for (const name of stepNames) {
    insertStep.run({
      id: crypto.randomBytes(6).toString("base64url"),
      taskId,
      name,
      status: ["extract", "transcribe", "rewrite", "subtitle", "render"].includes(name) ? "done" : "pending",
      output: JSON.stringify({ e2e: true }),
      progress: 1,
      startedAt: now,
      finishedAt: now,
    });
  }

  const insertArtifact = db.prepare(`
    INSERT INTO artifacts (id, task_id, step_name, kind, label, path, content, meta, created_at)
    VALUES (@id, @taskId, @stepName, @kind, @label, @path, @content, @meta, @createdAt)
  `);
  insertArtifact.run({
    id: crypto.randomBytes(6).toString("base64url"),
    taskId,
    stepName: "rewrite",
    kind: "rewrite",
    label: "toast e2e script",
    path: null,
    content: "这是一段用于失败 toast 验收的短口播稿。它不需要真实生成音频，只需要触发保存配置失败。",
    meta: null,
    createdAt: now,
  });
  insertArtifact.run({
    id: crypto.randomBytes(6).toString("base64url"),
    taskId,
    stepName: "images",
    kind: "image",
    label: "toast e2e image",
    path: path.relative(repoRoot, imagePath),
    content: null,
    meta: JSON.stringify({ idx: 0, brief: "窗边书桌的测试图" }),
    createdAt: now,
  });
  db.close();
  return { taskId, title };
}

function cleanupFixtureTask(taskId) {
  const db = new Database(dbPath);
  try {
    db.prepare("DELETE FROM artifacts WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM steps WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
  } finally {
    db.close();
  }
  fs.rmSync(path.join(repoRoot, "data", "tasks", taskId), { recursive: true, force: true });
}

async function launchChrome() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "book-video-studio-toast-e2e-"));
  const child = spawn(chromeBin, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for Chrome DevTools URL")), 30_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Chrome exited early with code ${code}`)));
  });
  return { child, userDataDir, wsUrl };
}

async function navigate(page, url) {
  await page("Page.navigate", { url });
  await waitForExpression(page, "document.readyState === 'complete' || document.readyState === 'interactive'");
}

async function clickButtonText(page, text) {
  await waitForExpression(page, `
    [...document.querySelectorAll("button")].some((button) => button.textContent.includes(${JSON.stringify(text)}) && !button.disabled)
  `);
  await evaluate(page, `
    (() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent.includes(${JSON.stringify(text)}) && !item.disabled);
      if (!button) throw new Error("button not found: ${text}");
      button.scrollIntoView({ block: "center" });
      button.click();
    })()
  `);
}

async function waitForText(page, text, timeoutMs = 10_000) {
  await waitForExpression(page, `document.body?.innerText.includes(${JSON.stringify(text)})`, timeoutMs);
}

async function assertNoText(page, texts) {
  const body = await evaluate(page, "document.body?.innerText || ''");
  for (const text of texts) {
    if (body.includes(text)) throw new Error(`Unexpected success text found: ${text}`);
  }
}

async function waitForExpression(page, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(page, expression);
      if (value) return value;
      last = String(value);
    } catch (e) {
      last = e?.message || String(e);
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for expression: ${expression.slice(0, 120)} (last: ${last})`);
}

async function evaluate(page, expression) {
  const result = await page("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

async function waitForServer(url) {
  const deadline = Date.now() + 60_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url);
      last = `HTTP ${resp.status}`;
      if (resp.status < 500) return;
    } catch (e) {
      const cause = e?.cause;
      last = [e?.message || String(e), cause?.code, cause?.address, cause?.port].filter(Boolean).join(" ");
    }
    await sleep(500);
  }
  throw new Error(`Server not reachable: ${url} (${last})`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
