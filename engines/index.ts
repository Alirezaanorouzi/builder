import type { CodingEngineProvider } from "./types";
import { getCodingEngineId, getCursorTransport } from "@/lib/config";
import { cursorEngineProvider } from "./cursor/provider";
import { cursorRestEngineProvider } from "./cursor/rest-provider";

export type { CodingEngineId, CodingEngineProvider, EngineStreamEvent } from "./types";

export { getCodingEngineId, getCursorTransport };

export function getCodingEngine(): CodingEngineProvider {
  return getCursorTransport() === "gateway" ? cursorRestEngineProvider : cursorEngineProvider;
}
