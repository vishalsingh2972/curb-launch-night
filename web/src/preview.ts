import { createInitialIncident } from "../../src/incident/simulation.ts";
import type { ActivityEvent, DashboardSnapshot, PreviewAdapter, PreviewScene } from "./adapter.ts";

const investigation: readonly ActivityEvent[] = [
  { id: "incident", offset: "00:00", kind: "incident", title: "Checkout degradation detected", detail: "Synthetic error rate crossed the 5% threshold after v2.4.1.", source: "preview-fixture" },
  { id: "metrics", offset: "00:04", kind: "tool_call", title: "check_metrics", detail: "Checkout API · 37.2% errors · deployment v2.4.1", source: "preview-fixture" },
  { id: "logs", offset: "00:08", kind: "tool_call", title: "inspect_logs", detail: "CHECKOUT_CONFIG_MISMATCH follows the latest deployment.", source: "preview-fixture" },
];
const verification: readonly ActivityEvent[] = [
  { id: "verification", offset: "00:16", kind: "operator_verified", title: "Operator verified", detail: "Preview fixture: session verification state changed.", source: "preview-fixture" },
  { id: "unlock", offset: "00:17", kind: "capability_unlocked", title: "Recovery capability unlocked", detail: "Preview fixture: React now renders the rollback Tool.", source: "preview-fixture" },
];
const recovery: readonly ActivityEvent[] = [
  { id: "confirmation", offset: "00:22", kind: "confirmation_pending", title: "Rollback confirmation requested", detail: "Preview fixture: v2.4.1 → v2.4.0, awaiting operator approval.", source: "preview-fixture" },
  { id: "recovery", offset: "00:28", kind: "rollback_completed", title: "Simulated recovery completed", detail: "Preview fixture: approval received; v2.4.0 · healthy · 1.1% errors.", source: "preview-fixture" },
];

/** Fixed display fixtures, not a second agent or an alternate authorization system.
 * Reuse the real initial data; never call verification or rollback handlers here. */
export function previewSnapshot(scene: PreviewScene): DashboardSnapshot {
  const recovered = scene === "recovered";
  const verified = scene !== "initial";
  const incident = {
    ...createInitialIncident(),
    operatorVerified: verified,
    ...(recovered ? { currentDeployment: "v2.4.0" as const, serviceHealth: "healthy" as const, errorRatePercent: 1.1, incidentStatus: "resolved" as const } : {}),
  };
  return {
    source: "preview",
    revision: scene,
    incident,
    confirmation: recovered ? "confirmed" : "none",
    capabilities: [
      { name: "check_metrics", description: "Read service health & deployment", availability: "available" },
      { name: "inspect_logs", description: "Investigate checkout failures", availability: "available" },
      { name: "verify_operator", description: "Validate the fictional demo PIN", availability: "available" },
      { name: "execute_rollback", description: recovered ? "Recovery completed for this scene" : verified ? "Available · caller confirmation required" : "Requires operator verification", availability: recovered ? "complete" : verified ? "available" : "locked" },
    ],
    // Clearly labeled fixtures mirror the sparse observations of the real demo, not fake traffic.
    errorSamples: [{ minute: 4 / 60, rate: 37.2 }, ...(recovered ? [{ minute: 28 / 60, rate: 1.1 }] : [])],
    activity: [...investigation, ...(verified ? verification : []), ...(recovered ? recovery : [])],
    observedEvents: [],
  };
}

export function createPreviewAdapter(): PreviewAdapter {
  let snapshot = previewSnapshot("initial");
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    selectScene: (scene) => {
      if (snapshot.revision === scene) return;
      snapshot = previewSnapshot(scene);
      listeners.forEach((listener) => listener());
    },
  };
}
