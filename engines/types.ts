/**
 * Shared contract for the Cursor Cloud Agents coding backend.
 */

export type CodingEngineId = "cursor";

/** Cursor Cloud Agent image payload (kept local so Next.js does not bundle @cursor/sdk). */
export type EnginePromptImage = {
  data: string;
  mimeType: string;
  dimension?: { width: number; height: number };
};

export interface TenantContext {
  siteId: string;
  repoUrl: string;
  repoRef: string;
  repoFullName: string;
  vercelProjectId: string;
  vercelTeamId?: string;
  productionUrl?: string;
  /** True when repo/Vercel come from SiteResources. */
  dedicated: boolean;
}

export interface StartRunInput {
  promptText: string;
  promptImages?: EnginePromptImage[];
  agentId: string | null;
  tenant: TenantContext;
  /**
   * Called as soon as the engine accepted the prompt (agent + run exist remotely).
   * Persist the ids here so a restart can re-attach instead of losing the run.
   */
  onRunStarted?: (info: { agentId: string; runId: string }) => void | Promise<void>;
}

export interface ResumeRunInput {
  agentId: string;
  runId: string;
  /** Called on every status poll (use it as a liveness heartbeat). */
  onHeartbeat?: () => void | Promise<void>;
}

export interface ExecuteRunResult extends EngineStreamResult {
  agentId: string;
  runId: string;
}

export interface CodingEngineProvider {
  readonly id: CodingEngineId;
  executeRun(
    input: StartRunInput,
    onEvent: (event: EngineStreamEvent) => void
  ): Promise<ExecuteRunResult>;
  /** Re-attach to a run that was started earlier (e.g. before a restart) and wait for its end. */
  resumeRun(
    input: ResumeRunInput,
    onEvent: (event: EngineStreamEvent) => void
  ): Promise<ExecuteRunResult>;
}

/** Alias used in architecture docs. */
export type CodingAgentProvider = CodingEngineProvider;

export type ActivityEventMeta = {
  tool?: string;
  path?: string;
  status?: string;
};

export type EngineStreamEvent =
  | { type: "status"; message: string }
  | { type: "assistant"; text: string }
  | { type: "activity"; message: string; meta?: ActivityEventMeta }
  | { type: "error"; message: string }
  | {
      type: "agent_done";
      status: "succeeded" | "failed";
      errorMessage?: string;
      finishedAt?: string;
    };

export interface EngineStreamResult {
  finished: boolean;
  /** When true, orchestrator should poll Vercel for preview URL. */
  requestPreview: boolean;
  commitSha?: string;
  /** Why the run did not finish (set when `finished` is false). */
  errorMessage?: string;
}
