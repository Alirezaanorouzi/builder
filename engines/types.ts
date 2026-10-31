/**
 * Shared contract for coding backends (Cursor Cloud Agents, OpenCode, …).
 * agentId + runId map to each engine’s session/run identifiers.
 */

export type CodingEngineId = "cursor" | "opencode";

export interface TenantContext {
  siteId: string;
  repoUrl: string;
  repoRef: string;
  repoFullName: string;
  vercelProjectId: string;
  vercelTeamId?: string;
  productionUrl?: string;
  /** OpenCode project root (absolute path inside worker container). */
  workspaceDirectory: string;
  /** True when repo/Vercel come from SiteResources, not global env. */
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
