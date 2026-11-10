import type { IncidentState } from "./simulation.ts";

/** Small, versioned display messages. No PINs, transcripts, secrets or client-supplied state. */
export const INCIDENT_EVENT_KEY = "launch-night.event.v1";
export const INCIDENT_SNAPSHOT_KEY = "launch-night.snapshot.v1";
export const RECENT_EVENT_LIMIT = 12;
export const INCIDENT_EVENT_TYPES = [
  "metrics_checked", "logs_inspected", "operator_verification_succeeded",
  "operator_verification_failed", "recovery_capability_unlocked", "rollback_executed", "service_recovered",
] as const;
export type IncidentEventType = typeof INCIDENT_EVENT_TYPES[number];
export type IncidentEvent = {
  version: 1;
  streamId: string;
  sequence: number;
  elapsedMs: number;
  type: IncidentEventType;
  simulated: true;
  incident: IncidentState;
};
export type IncidentSnapshot = {
  version: 1;
  streamId: string;
  sequence: number;
  simulated: true;
  incident: IncidentState;
  recentEvents: IncidentEvent[];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function isIncidentState(value: unknown): value is IncidentState {
  if (!record(value)) return false;
  const keys = ["service", "currentDeployment", "previousStableDeployment", "errorRatePercent", "serviceHealth", "incidentStatus", "operatorVerified", "cause"];
  if (Object.keys(value).some((key) => !keys.includes(key))) return false;
  return value.service === "Checkout API" && value.previousStableDeployment === "v2.4.0" &&
    typeof value.operatorVerified === "boolean" && typeof value.cause === "string" && value.cause.length <= 300 &&
    ((value.incidentStatus === "active" && value.currentDeployment === "v2.4.1" && value.serviceHealth === "degraded" && value.errorRatePercent === 37.2) ||
     (value.incidentStatus === "resolved" && value.currentDeployment === "v2.4.0" && value.serviceHealth === "healthy" && value.errorRatePercent === 1.1 && value.operatorVerified));
}
function envelope(value: Record<string, unknown>) {
  return value.version === 1 && value.simulated === true && typeof value.streamId === "string" &&
    value.streamId.length > 0 && value.streamId.length <= 100 && integer(value.sequence) && isIncidentState(value.incident);
}
export function isIncidentEvent(value: unknown): value is IncidentEvent {
  if (!record(value) || !envelope(value) || !integer(value.elapsedMs) || value.sequence === 0 ||
    !INCIDENT_EVENT_TYPES.includes(value.type as IncidentEventType)) return false;
  if (Object.keys(value).some((key) => !["version", "streamId", "sequence", "elapsedMs", "type", "simulated", "incident"].includes(key))) return false;
  const state = value.incident as IncidentState;
  if (["operator_verification_succeeded", "recovery_capability_unlocked"].includes(String(value.type)) && !state.operatorVerified) return false;
  if (value.type === "recovery_capability_unlocked" && state.incidentStatus !== "active") return false;
  if (["rollback_executed", "service_recovered"].includes(String(value.type)) && state.incidentStatus !== "resolved") return false;
  return true;
}
export function isIncidentSnapshot(value: unknown): value is IncidentSnapshot {
  if (!record(value) || !envelope(value) || !Array.isArray(value.recentEvents) || value.recentEvents.length > RECENT_EVENT_LIMIT) return false;
  if (Object.keys(value).some((key) => !["version", "streamId", "sequence", "simulated", "incident", "recentEvents"].includes(key))) return false;
  let previous = Math.max(0, (value.sequence as number) - value.recentEvents.length);
  for (const event of value.recentEvents) {
    if (!isIncidentEvent(event) || event.streamId !== value.streamId || event.sequence !== previous + 1) return false;
    previous = event.sequence;
  }
  if (previous !== value.sequence) return false;
  const last = value.recentEvents.at(-1) as IncidentEvent | undefined;
  return !last || Object.entries(last.incident).every(([key, entry]) => entry === (value.incident as Record<string, unknown>)[key]);
}
