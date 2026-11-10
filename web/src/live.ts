import { INCIDENT_EVENT_KEY, INCIDENT_SNAPSHOT_KEY, isIncidentEvent, isIncidentSnapshot, type IncidentEvent } from "../../src/incident/events.ts";
import { reportedCapabilities, type ActivityEvent, type DashboardAdapter, type DashboardSnapshot } from "./adapter.ts";

/** Matches the documented subset of curb/client AgentClient needed for read-only telemetry. */
export interface IncidentMessageClient {
  on(key: string, handler: (payload: unknown) => void): () => void;
  ask(key: string, payload: unknown): Promise<unknown>;
}
export interface LiveAdapter extends DashboardAdapter {
  readonly ready: Promise<void>;
  close(): void;
}

function activity(event: IncidentEvent): ActivityEvent {
  const descriptions = {
    metrics_checked: ["tool_call", "check_metrics", `${event.incident.errorRatePercent}% errors · ${event.incident.currentDeployment} · ${event.incident.serviceHealth}`],
    logs_inspected: ["tool_call", "inspect_logs", "Agent inspected the synthetic checkout log timeline."],
    operator_verification_succeeded: ["operator_verified", "Operator verification succeeded", "Demo PIN validated inside the agent; no PIN is sent to this page."],
    operator_verification_failed: ["verification_failed", "Operator verification failed", "The agent rejected the supplied demo PIN."],
    recovery_capability_unlocked: ["capability_unlocked", "Recovery capability unlocked", "Agent verification changed; Curb still owns caller confirmation."],
    rollback_executed: ["rollback_completed", "Simulated rollback executed", "Actual tool transition: v2.4.1 → v2.4.0. No production system changed."],
    service_recovered: ["service_recovered", "Service recovered", "Checkout API · healthy · 1.1% synthetic errors."],
  } as const;
  const [kind, title, detail] = descriptions[event.type];
  const seconds = Math.floor(event.elapsedMs / 1000);
  return { id: `${event.streamId}:${event.sequence}`, source: "curb-event", offset: `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`, kind, title, detail };
}

/** No commands, tokens, room creation, local-preview endpoint or preview-state fallback. */
export function createLiveAdapter(client?: IncidentMessageClient): LiveAdapter {
  let snapshot: DashboardSnapshot = {
    source: "curb", revision: "awaiting-session", incident: null, confirmation: "unobserved",
    connection: "waiting", connectionDetail: client ? "Synchronizing with the agent…" : "An already-joined Curb LiveKit room is required.",
    capabilities: reportedCapabilities(null), errorSamples: [], activity: [],
  };
  let closed = false;
  let streamId: string | null = null;
  let sequence = -1;
  let syncing = false;
  let queued: IncidentEvent[] = [];
  let history: IncidentEvent[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const unavailable = (connection: "waiting" | "disconnected" | "error", detail: string) => {
    snapshot = { ...snapshot, connection, connectionDetail: detail, capabilities: reportedCapabilities(snapshot.incident, false) };
    notify();
  };
  function update(incident: NonNullable<DashboardSnapshot["incident"]>, events: IncidentEvent[]) {
    const merged = new Map(history.map((event) => [event.sequence, event]));
    events.forEach((event) => merged.set(event.sequence, structuredClone(event)));
    history = [...merged.values()].sort((a, b) => a.sequence - b.sequence).slice(-100);
    const observations = history.filter((event) => event.type === "metrics_checked" || event.type === "service_recovered");
    snapshot = {
      source: "curb", revision: `${streamId}:${sequence}`, incident: { ...incident },
      confirmation: "unobserved", connection: "connected", connectionDetail: "Agent-reported simulated incident. Confirmation lifecycle is not streamed by this contract.",
      capabilities: reportedCapabilities(incident), activity: history.map(activity),
      // Only actual reported observations; never pad with preview chart history.
      errorSamples: observations.length ? observations.map((event) => ({ minute: event.elapsedMs / 60_000, rate: event.incident.errorRatePercent })) : [],
    };
    notify();
  }
  function buffer(event: IncidentEvent) { queued = [...queued, structuredClone(event)].slice(-32); }
  function flush() {
    const pending = queued.sort((a, b) => a.sequence - b.sequence);
    queued = [];
    for (const event of pending) {
      if (event.streamId !== streamId || event.sequence <= sequence) continue;
      if (event.sequence !== sequence + 1) {
        unavailable("error", "Event gap remains after synchronization. Reconnect to this session.");
        return;
      }
      sequence = event.sequence;
      update(event.incident, [event]);
    }
  }
  async function synchronize() {
    if (!client || closed || syncing) return;
    syncing = true;
    try {
      const payload = await client.ask(INCIDENT_SNAPSHOT_KEY, { version: 1 });
      if (closed) return;
      if (!isIncidentSnapshot(payload) || (streamId !== null && payload.streamId !== streamId) || payload.sequence < sequence) {
        unavailable("error", "Invalid, stale or different-session snapshot. Reconnect to the intended session.");
        return;
      }
      streamId = payload.streamId;
      sequence = payload.sequence;
      update(payload.incident, payload.recentEvents);
      flush();
    } catch {
      if (!closed) unavailable("error", "Unable to read the agent snapshot. Check the joined room, agent identity and deployed message handler.");
    } finally { syncing = false; }
  }
  // Listen before asking, so events racing the initial snapshot are buffered and reconciled.
  const unsubscribe = client?.on(INCIDENT_EVENT_KEY, (payload) => {
    if (closed || !isIncidentEvent(payload)) return;
    if (streamId !== null && payload.streamId !== streamId) return;
    if (syncing || streamId === null) { buffer(payload); return; }
    if (payload.sequence <= sequence) return;
    if (payload.sequence !== sequence + 1) {
      buffer(payload);
      unavailable("waiting", "A telemetry gap was detected; reading current agent state…");
      void synchronize();
      return;
    }
    sequence = payload.sequence;
    update(payload.incident, [payload]);
  });
  const ready = synchronize();
  return {
    ready,
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close: () => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      queued = [];
      unavailable("disconnected", "Dashboard event subscription closed; any values shown are last received, not current.");
      listeners.clear();
    },
  };
}
