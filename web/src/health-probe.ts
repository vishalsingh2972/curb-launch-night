import type { DashboardSnapshot } from "./adapter.ts";

const BRIDGE_URL = "http://127.0.0.1:4187";
const SESSION_ID = /^preview-[0-9a-f-]{36}$/;

export type ProbeState =
  | Readonly<{ kind: "unknown"; detail: string; httpStatus: null }>
  | Readonly<{ kind: "checking"; detail: string; httpStatus: null }>
  | Readonly<{ kind: "unavailable"; detail: string; httpStatus: number | null; probedAt: string }>
  | Readonly<{ kind: "observed"; detail: string; httpStatus: 200 | 503; health: "healthy" | "degraded"; deployment: "v2.4.0" | "v2.4.1"; observedAt: string; probedAt: string; highlightRecovered?: boolean }>;

/** A verification event changes neither health nor deployment, so it cannot trigger a probe. */
export function healthProbeKey(sessionId: string | undefined, snapshot: DashboardSnapshot): string | null {
  if (!sessionId || !SESSION_ID.test(sessionId) || snapshot.source !== "curb" ||
      snapshot.connection !== "connected" || !snapshot.incident) return null;
  return `${sessionId}:${snapshot.incident.currentDeployment}:${snapshot.incident.serviceHealth}`;
}

/** Mask a prior HTTP result in the same render that loses the selected live binding. */
export function visibleProbeState(key: string | null, state: ProbeState): ProbeState {
  return key ? state : { kind: "unknown", detail: "No current selected Curb session snapshot.", httpStatus: null };
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function isProbeBody(value: unknown, sessionId: string, status: number): value is {
  simulated: true; sessionId: string; health: "healthy" | "degraded";
  deployment: "v2.4.0" | "v2.4.1"; observedAt: string;
} {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return body.version === 1 && body.simulated === true && body.sessionId === sessionId &&
    body.source === "Launch Night local incident mirror" &&
    typeof body.observedAt === "string" && Number.isFinite(Date.parse(body.observedAt)) &&
    ((status === 503 && body.health === "degraded" && body.deployment === "v2.4.1" && body.errorRatePercent === 37.2) ||
     (status === 200 && body.health === "healthy" && body.deployment === "v2.4.0" && body.errorRatePercent === 1.1));
}

/** HTTP 503 is a valid degraded observation, not a fetch failure. */
export async function fetchHealthProbe(sessionId: string, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<ProbeState> {
  if (!SESSION_ID.test(sessionId)) return { kind: "unknown", detail: "Select a valid Curb preview session.", httpStatus: null };
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(2000)]) : AbortSignal.timeout(2000);
  const response = await fetcher(`${BRIDGE_URL}/sessions/${sessionId}/health`, { cache: "no-store", signal: boundedSignal });
  const probedAt = new Date().toISOString();
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  if (isProbeBody(body, sessionId, response.status)) {
    return {
      kind: "observed", httpStatus: response.status as 200 | 503,
      health: body.health, deployment: body.deployment, observedAt: body.observedAt, probedAt,
      detail: body.health === "healthy" ? "Synthetic checkout endpoint healthy." : "Synthetic checkout endpoint degraded.",
    };
  }
  if (response.status === 404 && body && typeof body === "object" &&
      (body as Record<string, unknown>).simulated === true && (body as Record<string, unknown>).health === "unknown") {
    return { kind: "unavailable", detail: "Selected session is unknown to the local bridge.", httpStatus: 404, probedAt };
  }
  return { kind: "unavailable", detail: "Probe returned an invalid or unavailable response.", httpStatus: response.status, probedAt };
}

/** Read-only controller shared by the React panel and deterministic tests. No polling. */
export function createHealthProbeController(fetcher: Fetcher = fetch) {
  let state: ProbeState = { kind: "unknown", detail: "Waiting for a current selected Curb session.", httpStatus: null };
  let key: string | null = null;
  let sessionId: string | undefined;
  let request = 0;
  let abort: AbortController | null = null;
  let lastObservedStatus: 200 | 503 | null = null;
  const listeners = new Set<() => void>();
  const set = (next: ProbeState) => { state = next; listeners.forEach((listener) => listener()); };
  async function run(): Promise<void> {
    if (!key || !sessionId) return;
    abort?.abort();
    abort = new AbortController();
    const current = ++request;
    set({ kind: "checking", detail: "Reading the local simulated health endpoint…", httpStatus: null });
    try {
      const result = await fetchHealthProbe(sessionId, fetcher, abort.signal);
      if (current === request) {
        if (result.kind === "observed") {
          const highlightRecovered = lastObservedStatus === 503 && result.httpStatus === 200;
          lastObservedStatus = result.httpStatus;
          set({ ...result, highlightRecovered });
        } else set(result);
      }
    } catch {
      if (current === request) set({ kind: "unavailable", detail: "Local bridge unreachable; no current HTTP result.", httpStatus: null, probedAt: new Date().toISOString() });
    }
  }
  function update(nextSessionId: string | undefined, snapshot: DashboardSnapshot): Promise<void> {
    const nextKey = healthProbeKey(nextSessionId, snapshot);
    if (nextKey === key) return Promise.resolve();
    abort?.abort();
    request++;
    key = nextKey;
    if (!nextKey || sessionId !== nextSessionId) lastObservedStatus = null;
    sessionId = nextKey ? nextSessionId : undefined;
    if (!nextKey) {
      set({ kind: "unknown", detail: "No current selected Curb session snapshot.", httpStatus: null });
      return Promise.resolve();
    }
    return run();
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update, run,
  };
}
