import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInitialIncident, executeRollback } from "../../src/incident/simulation.ts";
import { createLiveAdapter } from "../src/live.ts";
import { previewSnapshot } from "../src/preview.ts";
import { AgentXRay, deriveXRay } from "../src/xray.ts";
import { displayObservations, observationTime, presentationEventIds, presentationMotion } from "../src/presentation.ts";
import { readFileSync } from "node:fs";
import { presentationView, viewUrl, ViewToggle } from "../src/view.ts";

const markup = (snapshot) => renderToStaticMarkup(createElement(AgentXRay, { snapshot }));
const event = (sequence, type, incident, streamId = "session-a") =>
  ({ version: 1, simulated: true, streamId, sequence, elapsedMs: sequence * 1000, type, incident });
const snapshot = (incident) =>
  ({ version: 1, simulated: true, streamId: "session-a", sequence: 0, incident, recentEvents: [] });

test("presentation view preserves transport mode and exposes only view controls", () => {
  for (const mode of ["", "?mode=local", "?mode=live"]) {
    const href = `http://127.0.0.1:5173/${mode}`;
    const present = viewUrl(href, true);
    assert.equal(presentationView(new URL(present, href).search), true);
    assert.equal(new URL(present, href).searchParams.get("mode"), new URL(href).searchParams.get("mode"));
    assert.equal(presentationView(new URL(viewUrl(new URL(present, href).href, false), href).search), false);
  }
  assert.equal(viewUrl("http://127.0.0.1:5173/?mode=local&client.demo=night#main", true), "/?mode=local&client.demo=night&view=present#main");
  let chosen;
  const control = ViewToggle({ present: false, onChange: (value) => { chosen = value; } });
  control.props.children[1].props.onClick();
  assert.equal(chosen, true);
  const html = renderToStaticMarkup(createElement(ViewToggle, { present: true, onChange: () => {} }));
  assert.match(html, /aria-pressed="true">Presentation/);
  assert.doesNotMatch(html, /verify_operator|execute_rollback|2468/);
});

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
  assert.match(initial, /execute_rollback<\/code><small>Requires operator verification<\/small><\/span><strong>LOCKED/);
  assert.match(verified, /operatorVerified<\/code><strong class="xray-true">true/);
  assert.match(verified, /incidentActive<\/code><small>incidentStatus: active<\/small><\/span><strong class="">true/);
  assert.match(verified, /<strong>AVAILABLE<\/strong>/);
  assert.match(recovered, /operatorVerified<\/code><strong class="xray-true">true/);
  assert.match(recovered, /incidentActive<\/code><small>incidentStatus: resolved<\/small><\/span><strong class="xray-false">false/);
  assert.match(recovered, /<strong>REMOVED<\/strong>/);
  assert.match(recovered, /Removed after recovery/);
  assert.deepEqual(deriveXRay(previewSnapshot("recovered")).activeTools,
    ["check_metrics", "inspect_logs", "verify_operator"]);
  assert.equal(deriveXRay(previewSnapshot("initial")).activeTools.length, 3);
  assert.equal(deriveXRay(previewSnapshot("verified")).activeTools.length, 4);
  assert.match(verified, /JSX · abbreviated/);
  assert.match(verified, /gate-active/);
});

test("presentation emphasis requires new backend events; reconnects and session switches never replay success", async () => {
  const wire = channel();
  const adapter = createLiveAdapter(wire, "selected-session");
  const waiting = adapter.getSnapshot();
  await adapter.ready;
  let before = adapter.getSnapshot();
  assert.equal(presentationMotion(waiting, before), null);
  assert.deepEqual(presentationEventIds(waiting, before), []);
  assert.equal(presentationMotion(before, before), null);
  wire.emit(event(1, "metrics_checked", createInitialIncident()));
  assert.equal(presentationMotion(before, adapter.getSnapshot()), "investigation");
  before = adapter.getSnapshot();
  const verified = { ...createInitialIncident(), operatorVerified: true };
  // A state label without a captured verification event cannot trigger the unlock pulse.
  assert.equal(presentationMotion(before, { ...before, incident: verified }), null);
  wire.emit(event(2, "operator_verification_succeeded", verified));
  assert.equal(presentationMotion(before, adapter.getSnapshot()), "verified");
  before = adapter.getSnapshot();
  const recovered = executeRollback(verified).state;
  wire.emit(event(3, "rollback_executed", recovered));
  assert.equal(presentationMotion(before, adapter.getSnapshot()), null);
  assert.deepEqual(presentationEventIds(before, adapter.getSnapshot()), ["session-a:3"]);
  before = adapter.getSnapshot();
  wire.emit(event(4, "service_recovered", recovered));
  const after = adapter.getSnapshot();
  assert.equal(presentationMotion(before, after), "recovered");
  assert.equal(presentationMotion(before, { ...after, sessionId: "different-session" }), null);
  assert.equal(presentationMotion({ ...before, connection: "disconnected" }, after), null);
  assert.deepEqual(presentationEventIds({ ...before, connection: "disconnected" }, after), []);
  assert.equal(presentationMotion(after, after), null);
  adapter.markDisconnected("offline");
  assert.equal(presentationMotion(after, adapter.getSnapshot()), null);
  adapter.close();
});

test("source illustration follows the actual JSX gate and reduced motion disables every effect", () => {
  const source = readFileSync(new URL("../../src/agent/incident-context.tsx", import.meta.url), "utf8");
  assert.match(source, /incident\.operatorVerified && incident\.incidentStatus === "active" \? \(/);
  const html = markup(previewSnapshot("verified"));
  assert.match(html, /incident\.operatorVerified &amp;&amp;/);
  assert.match(html, /incident\.incidentStatus === &quot;active&quot;/);
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)[\s\S]*animation:none!important; transition:none!important/);
  assert.doesNotMatch(styles, /infinite/);
  assert.equal(observationTime(1.5), "+01:30");
  const samples = Array.from({ length: 9 }, (_, minute) => ({ minute, rate: minute ? 1.1 : 37.2 }));
  assert.deepEqual(displayObservations(samples), [samples[0], ...samples.slice(-5)]);
  assert.equal(displayObservations(samples).length, 6);
  assert.equal(displayObservations(samples)[0], samples[0], "the real initial observation remains visible");
});

test("X-Ray follows validated session events, ignores wrong-session data, and becomes unknown on disconnect", async () => {
  const wire = channel();
  const adapter = createLiveAdapter(wire);
  assert.match(markup(adapter.getSnapshot()), /<strong>UNKNOWN<\/strong>/);
  assert.deepEqual(deriveXRay(adapter.getSnapshot()).activeTools, []);
  await adapter.ready;
  assert.match(markup(adapter.getSnapshot()), /SESSION STATE/);
  assert.match(markup(adapter.getSnapshot()), /Context inspector/);
  assert.match(markup(adapter.getSnapshot()), /<strong>LOCKED<\/strong>/);

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
  assert.match(markup(adapter.getSnapshot()), /<strong>REMOVED<\/strong>/);
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
