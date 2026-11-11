import { createElement as h } from "react";
import type { DashboardSnapshot, ToolName } from "./adapter.ts";
import type { PresentationMotion } from "./presentation.ts";

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

function stateValue(value: boolean | null) {
  return value === null ? "unknown" : String(value);
}

export function AgentXRay({ snapshot, motion = null }: { snapshot: DashboardSnapshot; motion?: PresentationMotion }) {
  const view = deriveXRay(snapshot);
  const known = view.phase !== "unknown";
  return h("section", {
    className: `panel xray-panel xray-${view.phase} ${motion ? `motion-${motion}` : ""}`,
    "aria-label": "Agent X-Ray",
    "aria-live": "polite",
  },
    h("div", { className: "panel-heading xray-heading" },
      h("div", null, h("span", { className: "section-kicker" }, "REACT CONTEXT RUNTIME"), h("h2", null, "Agent X-Ray")),
      h("span", { className: "fixture-tag" }, view.source === "preview" ? "PREVIEW FIXTURE" : "SESSION STATE"),
    ),
    h("div", { className: "xray-body" },
      h("div", { className: "xray-state-grid" },
        h("div", { className: "xray-state" }, h("code", null, "operatorVerified"), h("strong", { className: view.operatorVerified === true ? "xray-true" : "" }, stateValue(view.operatorVerified))),
        h("div", { className: "xray-state" },
          h("span", { className: "xray-state-key" }, h("code", null, "incidentActive"), h("small", null, `incidentStatus: ${known ? snapshot.incident?.incidentStatus : "unknown"}`)),
          h("strong", { className: view.incidentActive === false ? "xray-false" : "" }, stateValue(view.incidentActive))),
      ),
      h("div", { className: "xray-render-path", "aria-label": "Illustrative event to state to React render pipeline" },
        h("span", null, h("small", null, "01 · TRIGGER"), h("code", null, view.phase === "recovered" ? "execute_rollback" : "verify_operator")),
        h("b", { "aria-hidden": true }, "→"),
        h("span", null, h("small", null, "02 · STATE"), h("code", null, "session state")),
        h("b", { "aria-hidden": true }, "→"),
        h("span", null, h("small", null, "03 · RENDER"), h("code", null, "React context")),
      ),
      h("div", { className: `xray-code-window ${view.rollbackAvailable ? "gate-active" : ""}` },
        h("div", { className: "xray-source-label" }, h("span", null, "incident-context.tsx"), h("span", null, "JSX · abbreviated")),
        h("pre", { className: "xray-source" }, h("code", null,
          h("span", { className: "syntax-condition" }, '{incident.operatorVerified &&\n  incident.incidentStatus === "active" ? ('), "\n",
          h("span", { className: "syntax-tool" }, '    <Tool name="execute_rollback" … />'), "\n  ) : null}")),
      ),
      h("div", { key: view.phase, className: `xray-result xray-result-${view.phase}` },
        h("span", null, h("code", null, "execute_rollback"), h("small", null, view.phase === "recovered" ? "Removed after recovery" : view.phase === "verified" ? "Rendered by the source gate" : view.phase === "unknown" ? "Awaiting current session state" : "Requires operator verification")),
        h("strong", null, known ? view.rollbackAvailable ? "AVAILABLE" : view.phase === "recovered" ? "REMOVED" : "LOCKED" : "UNKNOWN"),
      ),
      h("div", { className: "xray-tools" },
        h("span", null, h("strong", { className: "xray-tool-count" }, known ? String(view.activeTools.length).padStart(2, "0") : "—"), view.source === "preview" ? "Fixture available tools" : "Agent-reported available app tools"),
        h("div", { className: "xray-tool-list" }, known
          ? view.activeTools.map((name) => h("code", { key: name, className: name === "execute_rollback" ? "xray-unlocked-tool" : "" }, name))
          : h("em", null, "Unknown until a current snapshot arrives")),
      ),
      h("p", { className: "xray-disclaimer" }, view.source === "preview"
        ? "Fixture state only. Use Local Live Mirror for agent-reported state."
        : "Agent-reported state, not a captured LLM request. Curb's native Context inspector proves model-visible tools."),
    ),
  );
}
