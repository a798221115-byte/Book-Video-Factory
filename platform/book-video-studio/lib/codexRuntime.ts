import fs from "node:fs";
import path from "node:path";

const WINDOWS_FALLBACK_CODEX_PATH = "F:\\Codex\\tools\\codex-cli\\codex.exe";
const WINDOWS_FALLBACK_WORKSPACE = "F:\\Codex\\workspaces\\book-video-factory";

export function resolveCodexPathOverride() {
  const configured = String(process.env.BOOK_VIDEO_CODEX_PATH || "").trim();
  if (configured) {
    if (!fs.existsSync(configured)) {
      throw new Error(`BOOK_VIDEO_CODEX_PATH 指向的文件不存在：${configured}`);
    }
    return configured;
  }
  if (process.platform === "win32" && fs.existsSync(WINDOWS_FALLBACK_CODEX_PATH)) {
    return WINDOWS_FALLBACK_CODEX_PATH;
  }
  return undefined;
}

export function resolveCodexWorkingDirectory(projectRoot: string) {
  const configured = String(process.env.BOOK_VIDEO_CODEX_WORKDIR || "").trim();
  const candidate = configured ||
    (process.platform === "win32" && fs.existsSync(WINDOWS_FALLBACK_WORKSPACE)
      ? WINDOWS_FALLBACK_WORKSPACE
      : projectRoot);
  const resolved = path.resolve(candidate);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Codex 工作目录不存在：${resolved}`);
  }
  return resolved;
}
