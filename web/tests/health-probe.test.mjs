import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialIncident, executeRollback } from "../../src/incident/simulation.ts";
import { createLiveAdapter } from "../src/live.ts";
import { previewSnapshot } from "../src/preview.ts";
import { createHealthProbeController, fetchHealthProbe, healthProbeKey } from "../src/health-probe.ts";

const sessionId = "preview-11111111-1111-4111-8111-111111111111";
const initial = createInitialIncident();
const verified = { ...initial, operatorVerified: true };
const recovered = executeRollback(verified).state;
const body = (health, deployment, rate) => ({
  version: 1, simulated: true, source: "Launch Night local incident mirror", sessionId,
  health, deployment, errorRatePercent: rate, observedAt: "2026-01-01T00:00:00.000Z",
});
const response = (status, value) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const event = (sequence, type, incident, streamId = "session-a") =>
  ({ version: 1, simulated: true, streamId, sequence, elapsedMs: sequence * 1000, type, incident });
const snapshot = (incident) =>
  ({ version: 1, simulated: true, streamId: "session-a", sequence: 0, incident, recentEvents: [] });

function channel() {
  const listeners = new Set();
  return {
    on(_key, listener) { listeners.add(listener); return () => listeners.delete(listener); },
    ask() { return Promise.resolve(snapshot(initial)); },
    emit(value) { for (const listener of listeners) listener(value); },
  };
}

test("probe treats HTTP 503 as degraded observation and handles unknown and network failure", async () => {
  const degraded = await fetchHealthProbe(sessionId, async () => response(503, body("degraded", "v2.4.1", 37.2)));
  assert.equal(degraded.kind, "observed");
  assert.equal(degraded.httpStatus, 503);
  assert.equal(degraded.deployment, "v2.4.1");
  assert.ok(Number.isFinite(Date.parse(degraded.probedAt)));
  const healthy = await fetchHealthProbe(sessionId, async () => response(200, body("healthy", "v2.4.0", 1.1)));
  assert.equal(healthy.kind, "observed");
  assert.equal(healthy.httpStatus, 200);
  const unknown = await fetchHealthProbe(sessionId, async () => response(404, { version: 1, simulated: true, health: "unknown" }));
  assert.equal(unknown.kind, "unavailable");
  assert.equal(unknown.httpStatus, 404);
  const controller = createHealthProbeController(async () => { throw new Error("network offline"); });
  const wire = channel();
  const adapter = createLiveAdapter(wire);
  await adapter.ready;
  await controller.update(sessionId, adapter.getSnapshot());
  assert.equal(controller.getSnapshot().kind, "unavailable");
  assert.equal(controller.getSnapshot().httpStatus, null);
  adapter.close();
});

test("automatic probe follows only selected-session health/deployment changes", async () => {
  const wire = channel();
  const adapter = createLiveAdapter(wire);
  const calls = [];
  let probeResponse = response(503, body("degraded", "v2.4.1", 37.2));
  const controller = createHealthProbeController(async (url) => { calls.push(url); return probeResponse.clone(); });
  assert.equal(healthProbeKey(sessionId, adapter.getSnapshot()), null);
  assert.equal(healthProbeKey(sessionId, previewSnapshot("recovered")), null, "preview fixtures never start local probes");
  await adapter.ready;
  await controller.update(sessionId, adapter.getSnapshot());
  assert.equal(calls.length, 1);
  assert.equal(controller.getSnapshot().httpStatus, 503);
  const unchangedSnapshot = adapter.getSnapshot();
  await controller.run();
  assert.equal(calls.length, 2, "manual button repeats a GET only");
  assert.equal(adapter.getSnapshot(), unchangedSnapshot, "probe cannot mutate the agent adapter");

  const keyBeforeVerification = healthProbeKey(sessionId, adapter.getSnapshot());
  wire.emit(event(1, "operator_verification_succeeded", verified));
  wire.emit(event(2, "recovery_capability_unlocked", verified));
  assert.equal(healthProbeKey(sessionId, adapter.getSnapshot()), keyBeforeVerification);
  await controller.update(sessionId, adapter.getSnapshot());
  assert.equal(calls.length, 2, "verification alone does not re-probe or change HTTP health");
  wire.emit(event(3, "rollback_executed", recovered, "other-session"));
  await controller.update(sessionId, adapter.getSnapshot());
  assert.equal(calls.length, 2, "wrong-session event cannot trigger re-probe");

  probeResponse = response(200, body("healthy", "v2.4.0", 1.1));
  wire.emit(event(3, "rollback_executed", recovered));
  wire.emit(event(4, "service_recovered", recovered));
  await controller.update(sessionId, adapter.getSnapshot());
  assert.equal(calls.length, 3);
  assert.equal(controller.getSnapshot().httpStatus, 200);
  assert.equal(controller.getSnapshot().deployment, "v2.4.0");
  assert.equal(controller.getSnapshot().highlightRecovered, true, "pulse only on the observed 503 to 200 transition");
  assert.equal(calls.at(-1), `http://127.0.0.1:4187/sessions/${sessionId}/health`);
  await controller.run();
  assert.equal(controller.getSnapshot().highlightRecovered, false, "a repeated healthy GET does not replay the pulse");

  adapter.markDisconnected("Bridge disconnected");
  await controller.update(sessionId, adapter.getSnapshot());
  assert.equal(controller.getSnapshot().kind, "unknown");
  assert.equal(controller.getSnapshot().httpStatus, null, "do not present stale 200 as current");
  adapter.close();
});
