import type { SDKMessage } from "@cursor/sdk";
import type { EngineStreamEvent } from "@engines/types";

function pathFromToolArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  for (const key of ["path", "file_path", "target_file", "filePath", "relative_workspace_path"]) {
    if (typeof a[key] === "string" && a[key]) return a[key] as string;
  }
  return undefined;
}

function labelForTool(name: string, path: string | undefined, status: string): string {
  const n = name.toLowerCase();
  if (status === "completed" && !path) {
    return name;
  }
  if (n.includes("read") && path) return `Read ${path}`;
  if ((n.includes("write") || n.includes("edit") || n.includes("replace")) && path) {
    return `Edited ${path}`;
  }
  if (n.includes("grep") || n.includes("search")) return path ? `Searched ${path}` : "Searched codebase";
  if (n.includes("list") || n.includes("glob")) return path ? `Explored ${path}` : "Explored files";
  if (n.includes("terminal") || n.includes("run_terminal")) return "Ran terminal command";
  if (path) return `${name}: ${path}`;
  return name;
}

/** Map Cursor SDK stream messages → builder engine events (no synthetic pipeline steps). */
export function mapSdkMessageToEngineEvents(message: SDKMessage): EngineStreamEvent[] {
  switch (message.type) {
    case "assistant": {
      const text = message.message.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (!text.trim()) return [];
      return [{ type: "assistant", text }];
    }
    case "tool_call": {
      if (message.status !== "running") return [];
      const path = pathFromToolArgs(message.args);
      return [
        {
          type: "activity",
          message: labelForTool(message.name, path, message.status),
          meta: { tool: message.name, path, status: message.status },
        },
      ];
    }
    case "status": {
      if (message.message?.trim()) {
        return [{ type: "status", message: message.message }];
      }
      return [];
    }
    case "task": {
      if (message.text?.trim()) {
        return [{ type: "activity", message: message.text, meta: { status: message.status } }];
      }
      return [];
    }
    case "thinking":
    case "system":
    case "user":
    case "request":
    case "summary":
    case "usage":
      return [];
    default:
      return [];
  }
}
