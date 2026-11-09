/** Cursor `tool_call` → short Persian timeline labels (server + client). */

export type ToolActivityCategory =
  | "explore"
  | "search"
  | "read"
  | "edit"
  | "command"
  | "deploy"
  | "system";

const PATH_KEYS = [
  "path",
  "file_path",
  "target_file",
  "filePath",
  "relative_workspace_path",
] as const;

function pathFromRecord(obj: Record<string, unknown>): string | undefined {
  for (const key of PATH_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const success = obj.success;
  if (success && typeof success === "object" && !Array.isArray(success)) {
    const s = success as Record<string, unknown>;
    if (typeof s.path === "string" && s.path.trim()) return s.path.trim();
  }
  return undefined;
}

/** Extract file path from Cursor tool `args` / `result` JSON. */
export function pathFromToolPayload(args: unknown, result?: unknown): string | undefined {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const p = pathFromRecord(args as Record<string, unknown>);
    if (p) return p;
  }
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return pathFromRecord(result as Record<string, unknown>);
  }
  return undefined;
}

const COMMAND_KEYS = ["command", "cmd", "script"] as const;

/** Shell command text from a Cursor tool `args` payload. */
export function commandFromToolPayload(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const obj = args as Record<string, unknown>;
  for (const key of COMMAND_KEYS) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function isShellTool(toolName: string): boolean {
  const n = toolName.toLowerCase();
  return n.includes("terminal") || n.includes("shell") || n === "bash" || n === "exec";
}

/** Cursor Task is a nested subagent. Its own tools are not streamed, so the parent row sits until it exits. */
export function isTaskTool(toolName: string): boolean {
  const n = toolName.toLowerCase();
  return n === "task" || n.endsWith("_task");
}

function displayPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return parts[parts.length - 1] ?? normalized;
}

export function categoryForTool(toolName: string): ToolActivityCategory {
  const n = toolName.toLowerCase();
  if (n.includes("grep") || n.includes("search") || n === "codebase_search") return "search";
  if (n.includes("list") || n.includes("glob") || n.includes("explore")) return "explore";
  if (n.includes("read")) return "read";
  if (n.includes("write") || n.includes("edit") || n.includes("replace")) return "edit";
  if (isShellTool(toolName) || n.includes("browser")) return "command";
  if (n.includes("deploy") || n.includes("vercel")) return "deploy";
  return "system";
}

function shellLabel(command: string | undefined): string {
  const cmd = (command ?? "").toLowerCase();
  if (cmd.includes("typecheck") || /\btsc\b/.test(cmd)) return "بررسی نوع‌ها";
  if (
    cmd.includes("npm run build") ||
    cmd.includes("next build") ||
    cmd.includes("npm run check")
  ) {
    return "ساخت برای انتشار";
  }
  return "اجرای دستور";
}

/** Short Persian label for a tool step (filenames stay Latin). */
export function formatToolActivityLabel(
  toolName: string,
  path?: string,
  command?: string
): string {
  const n = toolName.toLowerCase();
  const file = path ? displayPath(path) : undefined;

  if (n.includes("read") || n === "read_file") {
    return file ? `خواندن ${file}` : "خواندن فایل";
  }
  if (
    n.includes("write") ||
    n.includes("edit") ||
    n.includes("replace") ||
    n === "search_replace"
  ) {
    return file ? `ویرایش ${file}` : "ویرایش فایل";
  }
  if (n.includes("grep") || n === "codebase_search" || n.includes("search")) {
    return file ? `جستجو در ${file}` : "جستجو در کد";
  }
  if (n.includes("list") || n.includes("glob") || n.includes("explore")) {
    return file ? `مرور ${file}` : "مرور فایل‌ها";
  }
  if (isShellTool(toolName)) return shellLabel(command);
  if (n.includes("browser")) {
    return "آزمایش در مرورگر";
  }
  if (n === "mcp") {
    return "اتصال ابزار";
  }
  return file ? `${toolName}: ${file}` : "انجام کار";
}

export function isLongRunningTool(toolName: string): boolean {
  return isShellTool(toolName);
}
