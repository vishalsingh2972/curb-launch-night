import { useEffect, useState, useSyncExternalStore } from "react";
import type { DashboardSnapshot } from "./adapter.ts";
import { createHealthProbeController, healthProbeKey } from "./health-probe.ts";

export function HealthProbePanel({ sessionId, snapshot }: { sessionId?: string; snapshot: DashboardSnapshot }) {
  const [controller] = useState(() => createHealthProbeController());
  const result = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const trigger = healthProbeKey(sessionId, snapshot);
  // The key changes only for a selected, connected session's health/deployment transition.
  useEffect(() => { void controller.update(sessionId, snapshot); }, [controller, trigger]);
  const observed = result.kind === "observed";
  const status = observed ? `HTTP ${result.httpStatus}` :
    result.kind === "unavailable" && result.httpStatus !== null ? `HTTP ${result.httpStatus}` : "UNKNOWN";
  const probedAt = "probedAt" in result ? new Date(result.probedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  return <section className={`health-probe-panel ${observed ? result.health : result.kind} ${observed && result.highlightRecovered ? "probe-recovered" : ""}`} aria-label="Checkout Health Probe" aria-live="polite">
    <div className="probe-heading"><div><h2>Checkout Health Probe</h2><p>Local simulated health endpoint</p></div><button type="button" disabled={!trigger || result.kind === "checking"} onClick={() => void controller.run()}>Run health probe</button></div>
    <div className="probe-result"><strong className="probe-status">{status}</strong><span>{result.detail}</span><code>{observed ? result.deployment : "Deployment unknown"}</code></div>
    <div className="probe-meta"><span>Last probe: {probedAt}</span><span>{observed ? "Agent snapshot mirrored by bridge" : "No current health claim"}</span></div>
  </section>;
}
