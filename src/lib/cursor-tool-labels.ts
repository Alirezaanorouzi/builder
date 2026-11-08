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
  if (n.includes("terminal") || n.includes("run_terminal") || n.includes("browser")) return "command";
  if (n.includes("deploy") || n.includes("vercel")) return "deploy";
  return "system";
}

/** Short Persian label for a tool step (filenames stay Latin). */
export function formatToolActivityLabel(toolName: string, path?: string): string {
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
  if (n.includes("terminal") || n.includes("run_terminal")) {
    return "اجرای دستور";
  }
  if (n.includes("browser")) {
    return "آزمایش در مرورگر";
  }
  if (n === "task" || n.includes("task")) {
    return "انجام کار";
  }
  if (n === "mcp") {
    return "اتصال ابزار";
  }
  return file ? `${toolName}: ${file}` : "انجام کار";
}

export function isLongRunningTool(toolName: string): boolean {
  const n = toolName.toLowerCase();
  return n === "task" || n.includes("task") || n === "mcp";
}
