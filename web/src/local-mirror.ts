import { INCIDENT_EVENT_KEY, INCIDENT_SNAPSHOT_KEY } from "../../src/incident/events.ts";
import { createLiveAdapter } from "./live.ts";

const BRIDGE_URL = "http://127.0.0.1:4187";

export type LocalSession = Readonly<{
  sessionId: string;
  sequence: number;
  updatedAt: number;
  deployment: string;
  health: string;
}>;

function isLocalSession(value: unknown): value is LocalSession {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.sessionId === "string" && /^preview-[0-9a-f-]{36}$/.test(entry.sessionId) &&
    Number.isSafeInteger(entry.sequence) && typeof entry.updatedAt === "number" &&
    (entry.deployment === "v2.4.1" || entry.deployment === "v2.4.0") &&
    (entry.health === "degraded" || entry.health === "healthy");
}

/** Browser receives only read-only SSE/GET; the private ingest token stays in Node. */
export function watchLocalSessions(onSessions: (sessions: LocalSession[]) => void, onError: () => void) {
  const source = new EventSource(`${BRIDGE_URL}/sessions/events`);
  source.addEventListener("sessions", (message) => {
    try {
      const value: unknown = JSON.parse((message as MessageEvent).data);
      if (Array.isArray(value) && value.every(isLocalSession)) onSessions(value);
    } catch { onError(); }
  });
  source.onerror = onError;
  return () => source.close();
}

export function connectLocalMirror(sessionId: string) {
  if (!/^preview-[0-9a-f-]{36}$/.test(sessionId)) throw new Error("Select a real Curb preview session ID.");
  const path = `${BRIDGE_URL}/sessions/${sessionId}`;
  const source = new EventSource(`${path}/events`);
  const client = {
    on(key: string, handler: (payload: unknown) => void) {
      if (key !== INCIDENT_EVENT_KEY) throw new Error("Unsupported local mirror message.");
      const listener = (message: Event) => {
        try { handler(JSON.parse((message as MessageEvent).data)); } catch { /* Invalid wire data is ignored. */ }
      };
      source.addEventListener("incident", listener);
      return () => source.removeEventListener("incident", listener);
    },
    async ask(key: string, payload: unknown): Promise<unknown> {
      if (key !== INCIDENT_SNAPSHOT_KEY || JSON.stringify(payload) !== '{"version":1}') throw new Error("Only a read-only snapshot is supported.");
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) throw new Error(`Local mirror snapshot unavailable (${response.status}).`);
      return response.json();
    },
  };
  const adapter = createLiveAdapter(client);
  source.onopen = () => { void adapter.ready.then(() => adapter.refresh()); };
  source.onerror = () => adapter.markDisconnected("Local bridge disconnected. Values shown are last received; reconnection will request a fresh snapshot.");
  return { adapter, close: () => { source.close(); adapter.close(); } };
}
