import { useEffect, useState, useSyncExternalStore } from "react";
import type { DashboardSnapshot } from "./adapter.ts";
import { createHealthProbeController, healthProbeKey, visibleProbeState } from "./health-probe.ts";

export function HealthProbePanel({ sessionId, snapshot }: { sessionId?: string; snapshot: DashboardSnapshot }) {
  const [controller] = useState(() => createHealthProbeController());
  const result = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const trigger = healthProbeKey(sessionId, snapshot);
  // The key changes only for a selected, connected session's health/deployment transition.
  useEffect(() => { void controller.update(sessionId, snapshot); }, [controller, trigger]);
  const shown = visibleProbeState(trigger, result);
  const observed = shown.kind === "observed";
  const status = observed ? `HTTP ${shown.httpStatus}` :
    shown.kind === "unavailable" && shown.httpStatus !== null ? `HTTP ${shown.httpStatus}` : "UNKNOWN";
  const probedAt = "probedAt" in shown ? new Date(shown.probedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  return <section className={`health-probe-panel ${observed ? shown.health : shown.kind} ${observed && shown.highlightRecovered ? "probe-recovered" : ""}`} aria-label="Checkout Health Probe" aria-live="polite">
    <div className="probe-heading"><div><span className="section-kicker">HTTP OBSERVATION</span><h2>Checkout Health Probe</h2><p>Local simulated health endpoint</p></div><button type="button" disabled={!trigger || shown.kind === "checking"} onClick={() => void controller.run()}>Run health probe <span aria-hidden="true">↗</span></button></div>
    <div className="probe-result"><strong className="probe-status">{status}</strong><span>{shown.detail}</span><code>{observed ? shown.deployment : "Deployment unknown"}</code></div>
    <div className="probe-meta"><span>Last probe: {probedAt}</span><span>{observed ? "Agent snapshot mirrored by bridge" : "No current health claim"}</span></div>
  </section>;
}
