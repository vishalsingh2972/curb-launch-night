import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialIncident, executeRollback } from "../../src/incident/simulation.ts";
import { createLiveAdapter } from "../src/live.ts";
import { previewSnapshot } from "../src/preview.ts";
import { createIncidentReport } from "../src/incident-report.ts";

const sessionA = "preview-11111111-1111-4111-8111-111111111111";
const sessionB = "preview-22222222-2222-4222-8222-222222222222";
const initial = createInitialIncident();
const verified = { ...initial, operatorVerified: true };
const recovered = executeRollback(verified).state;
const event = (sequence, type, incident, streamId = "stream-a") =>
  ({ version: 1, simulated: true, streamId, sequence, elapsedMs: sequence * 1000, type, incident });
const current = (streamId = "stream-a", incident = initial, events = []) =>
  ({ version: 1, simulated: true, streamId, sequence: events.at(-1)?.sequence ?? 0, incident, recentEvents: events });
function channel(first = current()) {
  const listeners = new Set();
  return {
    on(_key, listener) { listeners.add(listener); return () => listeners.delete(listener); },
    ask() { return Promise.resolve(first); },
    emit(value) { for (const listener of listeners) listener(value); },
  };
}

test("report unlocks only after observed rollback and recovery events in the selected session", async () => {
  const wire = channel();
  const adapter = createLiveAdapter(wire, sessionA);
  await adapter.ready;
  assert.equal(createIncidentReport(sessionA, adapter.getSnapshot()), null);
  wire.emit(event(1, "metrics_checked", initial));
  wire.emit(event(2, "logs_inspected", initial));
  wire.emit(event(3, "operator_verification_succeeded", verified));
  wire.emit(event(4, "recovery_capability_unlocked", verified));
  assert.equal(createIncidentReport(sessionA, adapter.getSnapshot()), null, "verification is not recovery");
  wire.emit(event(5, "rollback_executed", recovered));
  assert.equal(createIncidentReport(sessionA, adapter.getSnapshot()), null, "rollback needs the recovered-service event");
  wire.emit(event(6, "service_recovered", recovered));
  const report = createIncidentReport(sessionA, adapter.getSnapshot());
  assert.ok(report);
  assert.equal(report.eventCount, 6);
  assert.match(report.markdown, /Synthetic Checkout API demo/);
  assert.match(report.markdown, /Service: Checkout API \(synthetic\)/);
  assert.match(report.markdown, /Checkout errors started immediately after deployment v2\.4\.1/);
  assert.match(report.markdown, /First observed pre-recovery deployment: v2\.4\.1/);
  assert.match(report.markdown, /First observed pre-recovery error rate: 37\.2% \(synthetic\)/);
  assert.match(report.markdown, /Investigation tools observed: check_metrics, inspect_logs/);
  assert.match(report.markdown, /Successful operator-verification event: Observed at \+00:03/);
  assert.match(report.markdown, /Simulated rollback handler: Observed at \+00:05/);
  assert.match(report.markdown, /Service recovery event: Observed at \+00:06/);
  assert.match(report.markdown, /Final deployment: v2\.4\.0/);
  assert.match(report.markdown, /Final error rate: 1\.1% \(synthetic\)/);
  assert.match(report.markdown, /Caller confirmation: Not observed in application events/);
  assert.match(report.markdown, /\| \+00:01 \| check_metrics/);
  assert.doesNotMatch(report.markdown, /2468|KUGELAUDIO_API_KEY|Bearer /);
  adapter.close();
});

test("missing events are marked unobserved; no initial metrics, tools or approval are invented", async () => {
  const events = [event(5, "rollback_executed", recovered), event(6, "service_recovered", recovered)];
  const adapter = createLiveAdapter(channel(current("stream-a", recovered, events)), sessionA);
  await adapter.ready;
  const report = createIncidentReport(sessionA, adapter.getSnapshot());
  assert.ok(report);
  assert.match(report.markdown, /First observed pre-recovery deployment: Not observed/);
  assert.match(report.markdown, /First observed pre-recovery error rate: Not observed/);
  assert.match(report.markdown, /Investigation tools observed: Not observed/);
  assert.match(report.markdown, /Successful operator-verification event: Not observed/);
  assert.doesNotMatch(report.markdown, /check_metrics read|inspect_logs read|approval granted/);
  adapter.close();
});

test("reports remain isolated by selected session and disappear on disconnect", async () => {
  const events = [event(1, "operator_verification_succeeded", verified), event(2, "rollback_executed", recovered), event(3, "service_recovered", recovered)];
  const adapterA = createLiveAdapter(channel(current("stream-a", recovered, events)), sessionA);
  const adapterB = createLiveAdapter(channel(current("stream-b", initial)), sessionB);
  await Promise.all([adapterA.ready, adapterB.ready]);
  assert.ok(createIncidentReport(sessionA, adapterA.getSnapshot()));
  assert.equal(createIncidentReport(sessionB, adapterA.getSnapshot()), null, "session A cannot be relabeled as B");
  assert.equal(createIncidentReport(sessionB, adapterB.getSnapshot()), null);
  assert.equal(createIncidentReport(sessionA, previewSnapshot("recovered")), null, "fixture recovery is never downloadable as a live report");
  adapterA.markDisconnected("Bridge disconnected");
  assert.equal(createIncidentReport(sessionA, adapterA.getSnapshot()), null, "stale disconnected state is not a completed current report");
  adapterA.close();
  adapterB.close();
});

test("unverified or non-adjacent recovery evidence cannot unlock a report", async () => {
  const events = [event(1, "rollback_executed", recovered), event(2, "metrics_checked", recovered), event(3, "service_recovered", recovered)];
  const adapter = createLiveAdapter(channel(current("stream-a", recovered, events)), sessionA);
  await adapter.ready;
  assert.equal(createIncidentReport(sessionA, adapter.getSnapshot()), null);
  const unverified = { ...adapter.getSnapshot(), incident: { ...recovered, operatorVerified: false } };
  assert.equal(createIncidentReport(sessionA, unverified), null);
  adapter.close();
});

test("report excludes credentials and PIN-like content even if a validated cause changes", async () => {
  const unsafe = { ...recovered, cause: "PIN 2468; KUGELAUDIO_API_KEY=secret-value; Bearer token" };
  const events = [event(1, "rollback_executed", unsafe), event(2, "service_recovered", unsafe)];
  const adapter = createLiveAdapter(channel(current("stream-a", unsafe, events)), sessionA);
  await adapter.ready;
  const report = createIncidentReport(sessionA, adapter.getSnapshot());
  assert.ok(report);
  assert.match(report.markdown, /Reported cause: Not observed in report-safe synthetic state/);
  assert.doesNotMatch(report.markdown, /2468|KUGELAUDIO_API_KEY|secret-value|Bearer token/);
  adapter.close();
});
