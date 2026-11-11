import type { IncidentState } from "../../src/incident/simulation.ts";
import type { IncidentEvent } from "../../src/incident/events.ts";

/** Display contract only. A future transport maps validated Curb messages/events into this
 * shape. This interface intentionally grants no verification or recovery commands. */
export type ToolName = "check_metrics" | "inspect_logs" | "verify_operator" | "execute_rollback";
export type ActivityKind = "incident" | "tool_call" | "operator_verified" | "verification_failed" | "capability_unlocked" | "confirmation_pending" | "rollback_completed" | "service_recovered";
export type ActivityEvent = Readonly<{
  id: string;
  offset: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  source: "preview-fixture" | "curb-event";
}>;
export type Capability = Readonly<{
  name: ToolName;
  description: string;
  availability: "available" | "locked" | "complete" | "unknown";
}>;
export type ErrorSample = Readonly<{ minute: number; rate: number }>;
export type DashboardSnapshot = Readonly<{
  source: "preview" | "curb";
  sessionId?: string;
  revision: string;
  incident: Readonly<IncidentState> | null;
  confirmation: "none" | "pending" | "confirmed" | "cancelled" | "unobserved";
  connection?: "waiting" | "connected" | "disconnected" | "error";
  connectionDetail?: string;
  capabilities: readonly Capability[];
  errorSamples: readonly ErrorSample[];
  activity: readonly ActivityEvent[];
  observedEvents: readonly IncidentEvent[];
}>;
export interface DashboardAdapter {
  getSnapshot(): DashboardSnapshot;
  subscribe(listener: () => void): () => void;
}

export type PreviewScene = "initial" | "verified" | "recovered";
export interface PreviewAdapter extends DashboardAdapter {
  /** Local fixture selection only; never an agent command. */
  selectScene(scene: PreviewScene): void;
}

export function reportedCapabilities(incident: Readonly<IncidentState> | null, current = true): Capability[] {
  const rollback = !incident || !current ? "unknown" : incident.incidentStatus === "resolved" ? "complete" : incident.operatorVerified ? "available" : "locked";
  return [
    { name: "check_metrics", description: "Read service health & deployment", availability: current && incident ? "available" : "unknown" },
    { name: "inspect_logs", description: "Investigate checkout failures", availability: current && incident ? "available" : "unknown" },
    { name: "verify_operator", description: "Agent validates the fictional demo PIN", availability: current && incident ? "available" : "unknown" },
    { name: "execute_rollback", description: rollback === "unknown" ? "Awaiting current agent state" : rollback === "complete" ? "No longer rendered after recovery" : rollback === "available" ? "Agent verified · caller confirmation required" : "Requires operator verification", availability: rollback },
  ];
}
