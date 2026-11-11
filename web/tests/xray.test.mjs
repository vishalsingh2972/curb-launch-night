import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInitialIncident, executeRollback } from "../../src/incident/simulation.ts";
import { createLiveAdapter } from "../src/live.ts";
import { previewSnapshot } from "../src/preview.ts";
import { AgentXRay, deriveXRay } from "../src/xray.ts";

const markup = (snapshot) => renderToStaticMarkup(createElement(AgentXRay, { snapshot }));
const event = (sequence, type, incident, streamId = "session-a") =>
  ({ version: 1, simulated: true, streamId, sequence, elapsedMs: sequence * 1000, type, incident });
const snapshot = (incident) =>
  ({ version: 1, simulated: true, streamId: "session-a", sequence: 0, incident, recentEvents: [] });

function channel() {
  const listeners = new Set();
  return {
    on(_key, listener) { listeners.add(listener); return () => listeners.delete(listener); },
    ask() { return Promise.resolve(snapshot(createInitialIncident())); },
    emit(value) { for (const listener of listeners) listener(value); },
  };
}

test("X-Ray renders initial, verified and recovered preview fixture values", () => {
  const initial = markup(previewSnapshot("initial"));
  const verified = markup(previewSnapshot("verified"));
  const recovered = markup(previewSnapshot("recovered"));
  for (const html of [initial, verified, recovered]) {
    assert.match(html, /Agent X-Ray/);
    assert.match(html, /PREVIEW FIXTURE/);
    assert.match(html, /Fixture available tools/);
    assert.doesNotMatch(html, /2468|KUGELAUDIO_API_KEY/);
  }
  assert.match(initial, /operatorVerified<\/code><strong class="">false/);
  assert.match(initial, /incidentActive<\/code><small>incidentStatus: active<\/small><\/span><strong class="">true/);
  assert.match(initial, /execute_rollback<\/code><small>Derived from the source gate<\/small><\/span><strong>UNAVAILABLE/);
  assert.match(verified, /operatorVerified<\/code><strong class="xray-true">true/);
  assert.match(verified, /incidentActive<\/code><small>incidentStatus: active<\/small><\/span><strong class="">true/);
  assert.match(verified, /<strong>AVAILABLE<\/strong>/);
  assert.match(recovered, /operatorVerified<\/code><strong class="xray-true">true/);
  assert.match(recovered, /incidentActive<\/code><small>incidentStatus: resolved<\/small><\/span><strong class="xray-false">false/);
  assert.match(recovered, /<strong>UNAVAILABLE<\/strong>/);
  assert.deepEqual(deriveXRay(previewSnapshot("recovered")).activeTools,
    ["check_metrics", "inspect_logs", "verify_operator"]);
});

test("X-Ray follows validated session events, ignores wrong-session data, and becomes unknown on disconnect", async () => {
  const wire = channel();
  const adapter = createLiveAdapter(wire);
  assert.match(markup(adapter.getSnapshot()), /<strong>UNKNOWN<\/strong>/);
  assert.deepEqual(deriveXRay(adapter.getSnapshot()).activeTools, []);
  await adapter.ready;
  assert.match(markup(adapter.getSnapshot()), /SESSION STATE/);
  assert.match(markup(adapter.getSnapshot()), /Context inspector/);
  assert.match(markup(adapter.getSnapshot()), /<strong>UNAVAILABLE<\/strong>/);

  const verified = { ...createInitialIncident(), operatorVerified: true };
  wire.emit(event(1, "operator_verification_succeeded", verified, "other-session"));
  assert.equal(deriveXRay(adapter.getSnapshot()).operatorVerified, false);
  wire.emit(event(1, "operator_verification_succeeded", verified));
  wire.emit(event(2, "recovery_capability_unlocked", verified));
  assert.equal(deriveXRay(adapter.getSnapshot()).operatorVerified, true);
  assert.equal(deriveXRay(adapter.getSnapshot()).incidentActive, true);
  assert.match(markup(adapter.getSnapshot()), /<strong>AVAILABLE<\/strong>/);
  assert.ok(deriveXRay(adapter.getSnapshot()).activeTools.includes("execute_rollback"));

  const recovered = executeRollback(verified).state;
  wire.emit(event(3, "rollback_executed", recovered));
  wire.emit(event(4, "service_recovered", recovered));
  assert.equal(deriveXRay(adapter.getSnapshot()).incidentActive, false);
  assert.match(markup(adapter.getSnapshot()), /<strong>UNAVAILABLE<\/strong>/);
  assert.ok(!deriveXRay(adapter.getSnapshot()).activeTools.includes("execute_rollback"));
  assert.doesNotMatch(markup(adapter.getSnapshot()), /2468|KUGELAUDIO_API_KEY/);

  adapter.markDisconnected("Bridge disconnected");
  const disconnected = deriveXRay(adapter.getSnapshot());
  assert.equal(disconnected.phase, "unknown");
  assert.equal(disconnected.operatorVerified, null);
  assert.deepEqual(disconnected.activeTools, []);
  assert.match(markup(adapter.getSnapshot()), /Unknown until a current snapshot arrives/);
  adapter.close();
});
