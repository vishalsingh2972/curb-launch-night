import { createElement as h } from "react";
import type { DashboardSnapshot, ToolName } from "./adapter.ts";

export type XRayView = Readonly<{
  phase: "unknown" | "initial" | "verified" | "recovered";
  operatorVerified: boolean | null;
  incidentActive: boolean | null;
  rollbackAvailable: boolean | null;
  activeTools: readonly ToolName[];
  source: "preview" | "curb";
}>;

/** Read-only projection. A disconnected mirror has last-known data, not current state. */
export function deriveXRay(snapshot: DashboardSnapshot): XRayView {
  const current = snapshot.source === "preview" || snapshot.connection === "connected";
  if (!current || !snapshot.incident) {
    return { phase: "unknown", operatorVerified: null, incidentActive: null, rollbackAvailable: null, activeTools: [], source: snapshot.source };
  }
  const operatorVerified = snapshot.incident.operatorVerified;
  const incidentActive = snapshot.incident.incidentStatus === "active";
  const rollbackAvailable = operatorVerified && incidentActive;
  return {
    phase: incidentActive ? operatorVerified ? "verified" : "initial" : "recovered",
    operatorVerified,
    incidentActive,
    rollbackAvailable,
    activeTools: snapshot.capabilities.filter((tool) => tool.availability === "available").map((tool) => tool.name),
    source: snapshot.source,
  };
}

const gateSource = `{incident.operatorVerified &&
  incident.incidentStatus === "active" ? (
    <Tool name="execute_rollback" … />
  ) : null}`;

function stateValue(value: boolean | null) {
  return value === null ? "unknown" : String(value);
}

export function AgentXRay({ snapshot }: { snapshot: DashboardSnapshot }) {
  const view = deriveXRay(snapshot);
  const known = view.phase !== "unknown";
  const phaseText = view.phase === "verified" ? "Recovery unlocked" :
    view.phase === "recovered" ? "Recovery complete" :
    view.phase === "initial" ? "Recovery locked" : "Awaiting current session";
  const path = view.phase === "recovered"
    ? "confirmed execute_rollback → store update → React removes Tool"
    : view.phase === "verified"
      ? "verify_operator succeeded → store update → React renders Tool"
      : view.phase === "initial"
        ? "Successful verify_operator → store update → React renders Tool"
        : "Waiting for an agent snapshot; no state is inferred.";
  return h("section", {
    className: `panel xray-panel xray-${view.phase}`,
    "aria-label": "Agent X-Ray",
    "aria-live": "polite",
  },
    h("div", { className: "panel-heading xray-heading" },
      h("div", null, h("h2", null, "Agent X-Ray"), h("p", null, "Agent state → React render → capability")),
      h("span", { className: "fixture-tag" }, view.source === "preview" ? "PREVIEW FIXTURE" : "SESSION STATE"),
    ),
    h("div", { className: "xray-body" },
      h("div", { className: "xray-state-grid" },
        h("div", { className: "xray-state" }, h("code", null, "operatorVerified"), h("strong", { className: view.operatorVerified === true ? "xray-true" : "" }, stateValue(view.operatorVerified))),
        h("div", { className: "xray-state" },
          h("span", { className: "xray-state-key" }, h("code", null, "incidentActive"), h("small", null, `incidentStatus: ${known ? snapshot.incident?.incidentStatus : "unknown"}`)),
          h("strong", { className: view.incidentActive === false ? "xray-false" : "" }, stateValue(view.incidentActive))),
      ),
      h("div", { key: view.phase, className: `xray-result xray-result-${view.phase}` },
        h("span", null, h("code", null, "execute_rollback"), h("small", null, "Derived from the source gate")),
        h("strong", null, known ? view.rollbackAvailable ? "AVAILABLE" : "UNAVAILABLE" : "UNKNOWN"),
      ),
      h("div", { className: "xray-tools" },
        h("span", null, view.source === "preview" ? "Fixture available tools" : "Agent-reported available tools"),
        h("div", { className: "xray-tool-list" }, known
          ? view.activeTools.map((name) => h("code", { key: name, className: name === "execute_rollback" ? "xray-unlocked-tool" : "" }, name))
          : h("em", null, "Unknown until a current snapshot arrives")),
      ),
      h("div", { className: "xray-source-label" }, "Conditional Tool gate · src/agent/incident-context.tsx · Tool props omitted"),
      h("pre", { className: "xray-source" }, h("code", null, gateSource)),
      h("p", { className: "xray-flow" }, h("strong", null, phaseText), h("span", null, path)),
      h("p", { className: "xray-disclaimer" }, view.source === "preview"
        ? "Fixture state only. Use Local Live Mirror for agent-reported state."
        : "Agent-reported state, not a captured LLM request. Curb's native Context inspector proves model-visible tools."),
    ),
  );
}
