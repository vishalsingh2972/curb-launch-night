import type { DashboardSnapshot, ErrorSample } from "./adapter.ts";
import type { IncidentEvent } from "../../src/incident/events.ts";

export type PresentationMotion = "investigation" | "verified" | "recovered" | null;

function newBackendEvents(before: DashboardSnapshot, after: DashboardSnapshot): readonly IncidentEvent[] {
  if (before === after || before.source !== "curb" || after.source !== "curb" || before.connection !== "connected" || after.connection !== "connected" || before.sessionId !== after.sessionId) return [];
  const stream = before.revision.slice(0, before.revision.lastIndexOf(":"));
  if (!stream || !after.revision.startsWith(`${stream}:`)) return [];
  const sequence = Number(before.revision.slice(before.revision.lastIndexOf(":") + 1));
  return after.observedEvents.filter((event) => event.streamId === stream && event.sequence > sequence);
}

export function presentationEventIds(before: DashboardSnapshot, after: DashboardSnapshot): readonly string[] {
  if (before.source === "preview" && after.source === "preview") {
    const prior = new Set(before.activity.map((event) => event.id));
    return after.activity.filter((event) => !prior.has(event.id)).map((event) => event.id);
  }
  return newBackendEvents(before, after).map((event) => `${event.streamId}:${event.sequence}`);
}

/** Presentation only: a new event must accompany a transition in the same connected session. */
export function presentationMotion(before: DashboardSnapshot, after: DashboardSnapshot): PresentationMotion {
  if (before === after || before.source !== after.source || !before.incident || !after.incident) return null;
  if (after.source === "preview") {
    if (before.revision === after.revision) return null;
    return after.incident.incidentStatus === "resolved" ? "recovered" : after.incident.operatorVerified ? "verified" : "investigation";
  }
  const events = newBackendEvents(before, after);
  if (after.incident.incidentStatus === "resolved" && events.some((event) => event.type === "service_recovered")) return "recovered";
  if (!before.incident.operatorVerified && after.incident.operatorVerified && events.some((event) => event.type === "operator_verification_succeeded")) return "verified";
  return events.some((event) => event.type === "metrics_checked" || event.type === "logs_inspected") ? "investigation" : null;
}

export function observationTime(minute: number): string {
  const seconds = Math.floor(minute * 60);
  return `+${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Keep the incident's first observation visible beside the latest observations, without interpolation. */
export function displayObservations(samples: readonly ErrorSample[]): readonly ErrorSample[] {
  return samples.length > 6 ? [samples[0], ...samples.slice(-5)] : samples;
}
