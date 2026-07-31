import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const execFileP = promisify(execFile);
export const SOCIAL_UPLOAD_ROOT =
  process.env.SOCIAL_AUTO_UPLOAD_ROOT || "F:\\Codex\\tools\\social-auto-upload";
export const WEIXIN_ACCOUNTS_DIR =
  process.env.BOOK_VIDEO_WEIXIN_ACCOUNTS_DIR
  || "F:\\Codex\\data\\book-video-studio\\weixin-accounts";
export const SOCIAL_ACCOUNTS_DIR = process.env.SOCIAL_AUTO_UPLOAD_ACCOUNTS_DIR
  || path.join(SOCIAL_UPLOAD_ROOT, "cookies");
const SOCIAL_UPLOAD_PYTHON = process.env.SOCIAL_AUTO_UPLOAD_PYTHON
  || path.join(SOCIAL_UPLOAD_ROOT, ".venv", "Scripts", "python.exe");

export function listWeixinAccounts() {
  fs.mkdirSync(WEIXIN_ACCOUNTS_DIR, { recursive: true });
  return fs.readdirSync(WEIXIN_ACCOUNTS_DIR, { withFileTypes: true })
    .filter((item) => item.isFile() && item.name.toLowerCase().endsWith(".json"))
    .map((item) => ({
      id: path.basename(item.name, ".json"),
      label: path.basename(item.name, ".json"),
      file: path.join(WEIXIN_ACCOUNTS_DIR, item.name),
    }));
}

export function resolveWeixinAccount(accountId: string) {
  const account = listWeixinAccounts().find((item) => item.id === accountId);
  if (!account) throw new Error("未找到已登录的视频号账号，请先扫码生成账号 cookie");
  return account;
}

export type SocialPlatform = "douyin" | "weixin_channels";

export function listSocialAccounts() {
  const accounts: Array<{ platform: SocialPlatform; id: string; label: string; file: string }> = [];
  fs.mkdirSync(SOCIAL_ACCOUNTS_DIR, { recursive: true });
  for (const item of fs.readdirSync(SOCIAL_ACCOUNTS_DIR, { withFileTypes: true })) {
    if (!item.isFile() || !item.name.toLowerCase().endsWith(".json")) continue;
    const match = /^(douyin|tencent)_(.+)\.json$/i.exec(item.name);
    if (!match) continue;
    const platform: SocialPlatform = match[1].toLowerCase() === "douyin" ? "douyin" : "weixin_channels";
    accounts.push({
      platform,
      id: match[2],
      label: match[2],
      file: path.join(SOCIAL_ACCOUNTS_DIR, item.name),
    });
  }
  for (const account of listWeixinAccounts()) {
    if (!accounts.some((item) => item.platform === "weixin_channels" && item.id === account.id)) {
      accounts.push({ platform: "weixin_channels", ...account });
    }
  }
  return accounts;
}

export function resolveSocialAccount(platform: SocialPlatform, accountId: string) {
  const account = listSocialAccounts().find(
    (item) => item.platform === platform && item.id === accountId,
  );
  if (!account) throw new Error(`未找到 ${platform} 已登录账号：${accountId}`);
  return account;
}

export function draftIdempotencyKey(taskId: string, accountId: string, videoPath: string) {
  const stat = fs.statSync(videoPath);
  return createHash("sha256")
    .update(`${taskId}|${accountId}|${videoPath}|${stat.size}|${stat.mtimeMs}`)
    .digest("hex");
}

export function publicationIdempotencyKey(
  taskId: string,
  platform: SocialPlatform,
  accountId: string,
  videoPath: string,
) {
  const stat = fs.statSync(videoPath);
  return createHash("sha256")
    .update(`${taskId}|${platform}|${accountId}|${videoPath}|${stat.size}|${stat.mtimeMs}`)
    .digest("hex");
}

export async function publishSocialVideo(input: {
  platform: SocialPlatform;
  accountFile: string;
  videoPath: string;
  coverPath?: string;
  title: string;
  shortTitle: string;
  description: string;
  tags: string[];
}) {
  const script = path.join(process.cwd(), "scripts", "publish_social_video.py");
  const args = [
    script,
    "--tool-root", SOCIAL_UPLOAD_ROOT,
    "--platform", input.platform,
    "--account-file", input.accountFile,
    "--video", input.videoPath,
    "--title", input.title,
    "--short-title", input.shortTitle,
    "--description", input.description,
    "--tags-json", JSON.stringify(input.tags),
  ];
  if (input.coverPath && input.platform === "weixin_channels") {
    args.push("--cover", input.coverPath);
  }
  if (process.env.BOOK_VIDEO_UPLOAD_HEADLESS !== "0") args.push("--headless");
  const python = fs.existsSync(SOCIAL_UPLOAD_PYTHON) ? SOCIAL_UPLOAD_PYTHON : "python";
  const { stdout } = await execFileP(python, args, {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 30 * 60 * 1000,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH
        || path.join(SOCIAL_UPLOAD_ROOT, "ms-playwright"),
    },
  });
  const lastLine = stdout.trim().split(/\r?\n/).at(-1) || "{}";
  const result = JSON.parse(lastLine);
  if (!result.ok || result.mode !== "published" || result.platform !== input.platform) {
    throw new Error(`${input.platform} 未返回正式发布成功确认`);
  }
  return result;
}

export async function uploadWeixinDraft(input: {
  accountFile: string;
  videoPath: string;
  coverPath?: string;
  title: string;
  shortTitle: string;
  description: string;
  tags: string[];
}) {
  const script = path.join(process.cwd(), "scripts", "upload_weixin_draft.py");
  const args = [
    script,
    "--tool-root", SOCIAL_UPLOAD_ROOT,
    "--account-file", input.accountFile,
    "--video", input.videoPath,
    "--title", input.title,
    "--short-title", input.shortTitle,
    "--description", input.description,
    "--tags-json", JSON.stringify(input.tags),
  ];
  if (input.coverPath) args.push("--cover", input.coverPath);
  if (process.env.BOOK_VIDEO_UPLOAD_HEADLESS !== "0") args.push("--headless");
  const python = fs.existsSync(SOCIAL_UPLOAD_PYTHON) ? SOCIAL_UPLOAD_PYTHON : "python";
  const { stdout } = await execFileP(python, args, {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 30 * 60 * 1000,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH
        || path.join(SOCIAL_UPLOAD_ROOT, "ms-playwright"),
    },
  });
  const lastLine = stdout.trim().split(/\r?\n/).at(-1) || "{}";
  const result = JSON.parse(lastLine);
  if (!result.ok || result.mode !== "draft_only") throw new Error("视频号草稿上传未返回安全确认");
  return result;
}
