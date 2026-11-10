import { createAgentStore, type ToolResult } from "curb";
import { RECENT_EVENT_LIMIT, type IncidentEvent, type IncidentEventType, type IncidentSnapshot } from "./events.js";
import {
  createInitialIncident,
  executeRollback,
  readLogs,
  readMetrics,
  verifyOperator,
  type IncidentState,
} from "./simulation.js";

type IncidentStore = {
  incident: IncidentState;
  streamId: string;
  startedAt: number;
  sequence: number;
  recentEvents: IncidentEvent[];
  checkMetrics: () => ToolResult;
  inspectLogs: () => ToolResult;
  verifyOperator: (pin: string) => ToolResult;
  executeRollback: () => ToolResult;
  dashboardSnapshot: () => IncidentSnapshot;
};

// Only the hook definition is shared. Curb creates state/actions separately for each runtime.
export const useIncident = createAgentStore<IncidentStore>("launch-night-incident", (set, get) => {
  function recordEvents(types: IncidentEventType[]) {
    const current = get();
    const elapsedMs = Math.max(0, Date.now() - current.startedAt, current.recentEvents.at(-1)?.elapsedMs ?? 0);
    const events = types.map((type, index): IncidentEvent => ({
      version: 1, simulated: true, streamId: current.streamId, sequence: current.sequence + index + 1,
      elapsedMs, type, incident: { ...current.incident },
    }));
    set({ sequence: current.sequence + events.length, recentEvents: [...current.recentEvents, ...events].slice(-RECENT_EVENT_LIMIT) });
  }
  return {
    incident: createInitialIncident(),
    streamId: globalThis.crypto.randomUUID(),
    startedAt: Date.now(),
    sequence: 0,
    recentEvents: [],
    dashboardSnapshot: () => {
      const current = get();
      return { version: 1, simulated: true, streamId: current.streamId, sequence: current.sequence,
        incident: { ...current.incident }, recentEvents: current.recentEvents.map((event) => ({ ...event, incident: { ...event.incident } })) };
    },
    checkMetrics: () => {
      const data = readMetrics(get().incident);
      recordEvents(["metrics_checked"]);
      return { ok: true, data };
    },
    inspectLogs: () => {
      const data = readLogs(get().incident);
      recordEvents(["logs_inspected"]);
      return { ok: true, data };
    },
    verifyOperator: (pin) => {
      const before = get().incident;
      const transition = verifyOperator(get().incident, pin);
      set({ incident: transition.state });
      recordEvents(transition.result.ok
        ? ["operator_verification_succeeded", ...(!before.operatorVerified && transition.state.incidentStatus === "active" ? ["recovery_capability_unlocked" as const] : [])]
        : ["operator_verification_failed"]);
      return transition.result;
    },
    executeRollback: () => {
      // Read current session state at execution time, never a stale render closure.
      const before = get().incident;
      const transition = executeRollback(before);
      set({ incident: transition.state });
      if (transition.result.ok && before.incidentStatus === "active" && transition.state.incidentStatus === "resolved") {
        recordEvents(["rollback_executed", "service_recovered"]);
      }
      return transition.result;
    },
  };
});
