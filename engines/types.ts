/**
 * Shared contract for coding backends (Cursor Cloud Agents, OpenCode, …).
 * agentId + runId map to each engine’s session/run identifiers.
 */

export type CodingEngineId = "cursor" | "opencode";

export interface StartRunInput {
  promptText: string;
  /** Existing engine session id (Cursor agent id or OpenCode session id). */
  agentId: string | null;
}

export interface StartRunResult {
  agentId: string;
  runId: string;
}

export interface CodingEngineProvider {
  readonly id: CodingEngineId;
  startRun(input: StartRunInput): Promise<StartRunResult>;
  streamRun(
    agentId: string,
    runId: string,
    startedAt: number,
    onEvent: (event: EngineStreamEvent) => void
  ): Promise<EngineStreamResult>;
}

export type EngineStreamEvent =
  | { type: "status"; message: string }
  | { type: "assistant"; text: string }
  | { type: "activity"; message: string }
  | { type: "error"; message: string };

export interface EngineStreamResult {
  finished: boolean;
  /** When true, orchestrator should poll Vercel for preview URL. */
  requestPreview: boolean;
}
