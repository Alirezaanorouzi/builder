/**
 * Shared contract for the Cursor Cloud Agents coding backend.
 */

export type CodingEngineId = "cursor";

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
  agentId: string | null;
  tenant: TenantContext;
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
}
