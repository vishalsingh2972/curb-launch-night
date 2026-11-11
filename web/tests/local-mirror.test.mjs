import assert from "node:assert/strict";
import { test } from "node:test";
import { adapterForSelectedSession, connectLocalMirror, watchLocalSessions } from "../src/local-mirror.ts";
import { createInitialIncident } from "../../src/incident/simulation.ts";

const sessionId = "preview-11111111-1111-4111-8111-111111111111";
const streamId = "real-runtime-stream";
const initial = createInitialIncident();
const verified = { ...initial, operatorVerified: true };
const recovered = { ...verified, currentDeployment: "v2.4.0", serviceHealth: "healthy", incidentStatus: "resolved", errorRatePercent: 1.1 };
const event = (sequence, type, incident) => ({ version: 1, simulated: true, streamId, sequence, elapsedMs: sequence * 1000, type, incident });
const snapshot = () => ({ version: 1, simulated: true, streamId, sequence: 0, incident: initial, recentEvents: [] });

class FakeEventSource {
  static instances = [];
  constructor(url) { this.url = url; this.handlers = new Map(); this.closed = false; FakeEventSource.instances.push(this); }
  addEventListener(name, handler) { const listeners = this.handlers.get(name) ?? new Set(); listeners.add(handler); this.handlers.set(name, listeners); }
  removeEventListener(name, handler) { this.handlers.get(name)?.delete(handler); }
  emit(name, value) { for (const handler of this.handlers.get(name) ?? []) handler({ data: JSON.stringify(value) }); }
  close() { this.closed = true; }
}

test("local mirror consumes only selected-session bridge messages and never changes agent state itself", async () => {
  const originalEventSource = globalThis.EventSource;
  const originalFetch = globalThis.fetch;
  globalThis.EventSource = FakeEventSource;
  globalThis.fetch = async (url) => {
    assert.equal(url, `http://127.0.0.1:4187/sessions/${sessionId}`);
    return { ok: true, json: async () => snapshot() };
  };
  try {
    const connection = connectLocalMirror(sessionId);
    await connection.adapter.ready;
    const source = FakeEventSource.instances.at(-1);
    assert.equal(connection.adapter.getSnapshot().incident.errorRatePercent, 37.2);
    assert.equal(connection.adapter.getSnapshot().sessionId, sessionId);
    assert.equal(connection.adapter.getSnapshot().capabilities.at(-1).availability, "locked");
    source.emit("incident", event(1, "metrics_checked", initial));
    source.emit("incident", event(2, "logs_inspected", initial));
    assert.deepEqual(connection.adapter.getSnapshot().activity.map((item) => item.title), ["check_metrics", "inspect_logs"]);
    source.emit("incident", event(3, "operator_verification_succeeded", verified));
    source.emit("incident", event(4, "recovery_capability_unlocked", verified));
    assert.equal(connection.adapter.getSnapshot().capabilities.at(-1).availability, "available");
    assert.equal(connection.adapter.getSnapshot().confirmation, "unobserved");
    source.emit("incident", event(5, "rollback_executed", recovered));
    source.emit("incident", event(6, "service_recovered", recovered));
    assert.equal(connection.adapter.getSnapshot().incident.currentDeployment, "v2.4.0");
    assert.equal(connection.adapter.getSnapshot().incident.errorRatePercent, 1.1);
    assert.equal(connection.adapter.getSnapshot().capabilities.at(-1).availability, "complete");
    source.onerror();
    assert.equal(connection.adapter.getSnapshot().connection, "disconnected");
    assert.equal(connection.adapter.getSnapshot().capabilities.at(-1).availability, "unknown");
    connection.close();
    assert.equal(source.closed, true);
    assert.throws(() => connectLocalMirror("another-session"), /real Curb preview session ID/);
  } finally {
    globalThis.EventSource = originalEventSource;
    globalThis.fetch = originalFetch;
  }
});

test("a new session selection displays unknown state until its own adapter binds", () => {
  const oldAdapter = { getSnapshot: () => ({ incident: recovered }), subscribe: () => () => {} };
  const waitingAdapter = { getSnapshot: () => ({ incident: null }), subscribe: () => () => {} };
  const nextSession = "preview-22222222-2222-4222-8222-222222222222";
  assert.equal(adapterForSelectedSession(nextSession, sessionId, oldAdapter, waitingAdapter), waitingAdapter);
  assert.equal(adapterForSelectedSession(sessionId, sessionId, oldAdapter, waitingAdapter), oldAdapter);
});

test("session discovery exposes only listed preview IDs and closes its SSE listener", () => {
  const originalEventSource = globalThis.EventSource;
  globalThis.EventSource = FakeEventSource;
  try {
    let current = [];
    const close = watchLocalSessions((sessions) => { current = sessions; }, () => {});
    const source = FakeEventSource.instances.at(-1);
    source.emit("sessions", [{ sessionId, sequence: 0, updatedAt: 1, deployment: "v2.4.1", health: "degraded" }]);
    assert.equal(current[0].sessionId, sessionId);
    source.emit("sessions", [{ sessionId: "forged", sequence: 1, updatedAt: 2, deployment: "v2.4.0", health: "healthy" }]);
    assert.equal(current[0].sessionId, sessionId);
    close();
    assert.equal(source.closed, true);
  } finally { globalThis.EventSource = originalEventSource; }
});
