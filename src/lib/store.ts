import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export interface ChatSession {
  id: string;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoreFile {
  sessions: Record<string, ChatSession>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "sessions.json");

function readStore(): StoreFile {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return { sessions: {} };
    }
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as StoreFile;
  } catch {
    return { sessions: {} };
  }
}

function writeStore(data: StoreFile) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export function createSession(): ChatSession {
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: randomUUID(),
    agentId: null,
    createdAt: now,
    updatedAt: now,
  };
  const store = readStore();
  store.sessions[session.id] = session;
  writeStore(store);
  return session;
}

export function getSession(id: string): ChatSession | null {
  const store = readStore();
  return store.sessions[id] ?? null;
}

export function setSessionAgentId(sessionId: string, agentId: string): ChatSession {
  const store = readStore();
  const session = store.sessions[sessionId];
  if (!session) {
    throw new Error("Session not found");
  }
  session.agentId = agentId;
  session.updatedAt = new Date().toISOString();
  writeStore(store);
  return session;
}

export function getOrCreateSession(sessionId: string | null | undefined): ChatSession {
  if (sessionId) {
    const existing = getSession(sessionId);
    if (existing) return existing;
  }
  return createSession();
}
