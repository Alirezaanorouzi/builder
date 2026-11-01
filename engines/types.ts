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
    tenant: TenantContext,
    onEvent: (event: EngineStreamEvent) => void
  ): Promise<EngineStreamResult>;
}

/** Alias used in architecture docs. */
export type CodingAgentProvider = CodingEngineProvider;

export type EngineStreamEvent =
  | { type: "status"; message: string }
  | { type: "assistant"; text: string }
  | { type: "activity"; message: string }
  | { type: "error"; message: string };

export interface EngineStreamResult {
  finished: boolean;
  /** When true, orchestrator should poll Vercel for preview URL. */
  requestPreview: boolean;
  commitSha?: string;
}
