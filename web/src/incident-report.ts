import { isIncidentEvent, isIncidentState, type IncidentEvent } from "../../src/incident/events.ts";
import { createInitialIncident } from "../../src/incident/simulation.ts";
import type { DashboardSnapshot } from "./adapter.ts";

const SESSION_ID = /^preview-[0-9a-f-]{36}$/;
const safeDemoCause = createInitialIncident().cause;

export type CompletedIncidentReport = Readonly<{ markdown: string; eventCount: number; sessionId: string }>;

function elapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `+${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function eventDescription(event: IncidentEvent): string {
  switch (event.type) {
    case "metrics_checked": return `check_metrics read ${event.incident.errorRatePercent}% synthetic errors on ${event.incident.currentDeployment}.`;
    case "logs_inspected": return "inspect_logs read the synthetic checkout log timeline.";
    case "operator_verification_succeeded": return "Operator verification succeeded in the agent.";
    case "operator_verification_failed": return "Operator verification failed in the agent.";
    case "recovery_capability_unlocked": return "Recovery capability unlocked by agent state.";
    case "rollback_executed": return "Simulated rollback handler executed.";
    case "service_recovered": return `Service recovered: ${event.incident.currentDeployment}, ${event.incident.errorRatePercent}% synthetic errors.`;
  }
}

/** Uses only a connected selected session and its validated, recorded backend events. */
export function createIncidentReport(selectedSessionId: string | undefined, snapshot: DashboardSnapshot): CompletedIncidentReport | null {
  if (!selectedSessionId || !SESSION_ID.test(selectedSessionId) || snapshot.source !== "curb" ||
      snapshot.sessionId !== selectedSessionId || snapshot.connection !== "connected" ||
      !isIncidentState(snapshot.incident) || snapshot.incident.incidentStatus !== "resolved") return null;
  const events = snapshot.observedEvents;
  if (!events.length || !events.every(isIncidentEvent)) return null;
  const streamId = events[0].streamId;
  if (events.some((event) => event.streamId !== streamId)) return null;
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  if (snapshot.revision !== `${streamId}:${ordered.at(-1)?.sequence}`) return null;
  const recovery = [...ordered].reverse().find((event) => event.type === "service_recovered");
  const rollback = recovery && [...ordered].reverse().find((event) => event.type === "rollback_executed" && event.sequence < recovery.sequence);
  if (!recovery || !rollback || recovery.sequence !== rollback.sequence + 1 ||
      rollback.incident.currentDeployment !== recovery.incident.currentDeployment ||
      rollback.incident.errorRatePercent !== recovery.incident.errorRatePercent ||
      recovery.incident.currentDeployment !== snapshot.incident.currentDeployment ||
      recovery.incident.errorRatePercent !== snapshot.incident.errorRatePercent ||
      recovery.incident.serviceHealth !== snapshot.incident.serviceHealth) return null;

  const before = ordered.find((event) => event.sequence < rollback.sequence && event.incident.incidentStatus === "active");
  const investigation = ordered.filter((event) => event.type === "metrics_checked" || event.type === "logs_inspected");
  const tools = [...new Set(investigation.map((event) => event.type === "metrics_checked" ? "check_metrics" : "inspect_logs"))];
  const verification = ordered.find((event) => event.type === "operator_verification_succeeded" && event.sequence < rollback.sequence);
  const cause = snapshot.incident.cause === safeDemoCause ? snapshot.incident.cause : "Not observed in report-safe synthetic state.";
  const timeline = ordered.map((event) => `| ${elapsed(event.elapsedMs)} | ${eventDescription(event)} |`);
  const markdown = [
    "# Launch Night — Post-Incident Report",
    "",
    "> Synthetic Checkout API demo. All deployments, health values, error rates and logs below are simulated. This is not production telemetry.",
    "",
    `- Selected local Curb session reference: ${selectedSessionId.slice(-8)}.`,
    "- Evidence: validated agent application events received by Local Live Mirror.",
    "- Timing: relative offsets supplied by the agent event stream; no wall-clock event times were captured.",
    "",
    "## Incident",
    `- Service: ${snapshot.incident.service} (synthetic).`,
    `- Reported cause: ${cause}`,
    `- First observed pre-recovery deployment: ${before?.incident.currentDeployment ?? "Not observed"}.`,
    `- First observed pre-recovery error rate: ${before ? `${before.incident.errorRatePercent}% (synthetic)` : "Not observed"}.`,
    "",
    "## Investigation and recovery",
    `- Investigation tools observed: ${tools.length ? tools.join(", ") : "Not observed"}.`,
    `- Successful operator-verification event: ${verification ? `Observed at ${elapsed(verification.elapsedMs)}` : "Not observed in the retained event stream"}.`,
    "- Caller confirmation: Not observed in application events. Consult the native Curb preview for the confirmation interaction.",
    `- Simulated rollback handler: Observed at ${elapsed(rollback.elapsedMs)}.`,
    `- Service recovery event: Observed at ${elapsed(recovery.elapsedMs)}.`,
    `- Final deployment: ${snapshot.incident.currentDeployment}.`,
    `- Final health: ${snapshot.incident.serviceHealth}.`,
    `- Final error rate: ${snapshot.incident.errorRatePercent}% (synthetic).`,
    "",
    "## Observed backend timeline",
    "| Relative time | Recorded event |",
    "| --- | --- |",
    ...timeline,
    "",
  ].join("\n");
  return { markdown, eventCount: ordered.length, sessionId: selectedSessionId };
}
