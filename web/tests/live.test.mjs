import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialIncident } from "../../src/incident/simulation.ts";
import { INCIDENT_EVENT_KEY, INCIDENT_SNAPSHOT_KEY, isIncidentEvent, isIncidentSnapshot } from "../../src/incident/events.ts";
import { createLiveAdapter } from "../src/live.ts";
import { connectLiveDashboard } from "../src/connect.ts";

const event = (sequence, type = "metrics_checked", incident = createInitialIncident()) =>
  ({ version: 1, simulated: true, streamId: "session-a", sequence, elapsedMs: sequence * 1000, type, incident });
const snapshot = (events = [], incident = events.at(-1)?.incident ?? createInitialIncident()) =>
  ({ version: 1, simulated: true, streamId: "session-a", sequence: events.at(-1)?.sequence ?? 0, incident, recentEvents: events });
function channel(ask) {
  const listeners = new Set();
  return {
    listeners,
    on(key, listener) { assert.equal(key, INCIDENT_EVENT_KEY); listeners.add(listener); return () => listeners.delete(listener); },
    ask(key, payload) { assert.equal(key, INCIDENT_SNAPSHOT_KEY); assert.deepEqual(payload, { version: 1 }); return ask(); },
    emit(payload) { listeners.forEach((listener) => listener(payload)); },
  };
}

test("unconnected Live Mode shows unknown state with no fixture fallback or command methods", async () => {
  const adapter = createLiveAdapter();
  await adapter.ready;
  assert.equal(adapter.getSnapshot().source, "curb");
  assert.equal(adapter.getSnapshot().incident, null);
  assert.equal(adapter.getSnapshot().activity.length, 0);
  assert.equal(adapter.getSnapshot().errorSamples.length, 0);
  assert.ok(adapter.getSnapshot().capabilities.every((capability) => capability.availability === "unknown"));
  assert.equal("selectScene" in adapter, false);
  assert.equal("executeRollback" in adapter, false);
  assert.equal("verifyOperator" in adapter, false);
});

test("initial snapshot races are reconciled, duplicates and invalid/wrong-session events ignored", async () => {
  let resolve;
  const client = channel(() => new Promise((done) => { resolve = done; }));
  const adapter = createLiveAdapter(client);
  client.emit(event(1));
  resolve(snapshot());
  await adapter.ready;
  assert.equal(adapter.getSnapshot().connection, "connected");
  assert.equal(adapter.getSnapshot().activity.length, 1);
  assert.equal(adapter.getSnapshot().errorSamples.length, 1, "do not invent 15 minutes of chart data");
  const current = adapter.getSnapshot();
  client.emit(event(1));
  client.emit({ ...event(2), streamId: "other-session" });
  client.emit({ ...event(2), version: 2 });
  client.emit({ ...event(2), pin: "2468" });
  assert.equal(adapter.getSnapshot(), current);
  const verified = { ...createInitialIncident(), operatorVerified: true };
  client.emit(event(2, "operator_verification_succeeded", verified));
  client.emit(event(3, "recovery_capability_unlocked", verified));
  assert.equal(adapter.getSnapshot().capabilities.at(-1).availability, "available");
  assert.equal(adapter.getSnapshot().confirmation, "unobserved");
  adapter.close();
  assert.equal(client.listeners.size, 0);
  assert.ok(adapter.getSnapshot().capabilities.every((capability) => capability.availability === "unknown"));
});

test("an event gap requests a real snapshot instead of guessing missing transitions", async () => {
  let asks = 0;
  const client = channel(async () => ++asks === 1 ? snapshot() : snapshot([event(1), event(2, "logs_inspected"), event(3)]));
  const adapter = createLiveAdapter(client);
  await adapter.ready;
  client.emit(event(3));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(asks, 2);
  assert.equal(adapter.getSnapshot().connection, "connected");
  assert.equal(adapter.getSnapshot().activity.length, 3);
  assert.equal(new Set(adapter.getSnapshot().activity.map((item) => item.id)).size, 3);
});

test("a late response after cleanup cannot repopulate state or notify subscribers", async () => {
  let resolve;
  const client = channel(() => new Promise((done) => { resolve = done; }));
  const adapter = createLiveAdapter(client);
  let notifications = 0;
  adapter.subscribe(() => notifications++);
  adapter.close();
  assert.equal(notifications, 1);
  resolve(snapshot());
  await adapter.ready;
  assert.equal(adapter.getSnapshot().connection, "disconnected");
  assert.equal(adapter.getSnapshot().incident, null);
  assert.equal(notifications, 1);
});

test("invalid snapshots fail visibly and event contracts enforce coherent simulated state", async () => {
  assert.equal(isIncidentEvent({ ...event(1), incident: { ...createInitialIncident(), serviceHealth: "healthy" } }), false);
  assert.equal(isIncidentEvent(event(1, "recovery_capability_unlocked")), false);
  assert.equal(isIncidentSnapshot(snapshot([event(1), event(3)])), false);
  assert.equal(isIncidentSnapshot({ ...snapshot(), operatorVerified: true }), false);
  assert.equal(isIncidentSnapshot({ ...snapshot([event(1)]), incident: { ...createInitialIncident(), operatorVerified: true } }), false);
  const adapter = createLiveAdapter(channel(async () => ({ version: 2 })));
  await adapter.ready;
  assert.equal(adapter.getSnapshot().connection, "error");
  assert.equal(adapter.getSnapshot().incident, null);
});

test("recovery uses reported metrics and retains synthetic labels without claiming confirmation", async () => {
  const verified = { ...createInitialIncident(), operatorVerified: true };
  const client = channel(async () => snapshot([event(1, "operator_verification_succeeded", verified)]));
  const adapter = createLiveAdapter(client);
  await adapter.ready;
  const recovered = { ...verified, currentDeployment: "v2.4.0", serviceHealth: "healthy", incidentStatus: "resolved", errorRatePercent: 1.1 };
  client.emit(event(2, "rollback_executed", recovered));
  client.emit(event(3, "service_recovered", recovered));
  assert.equal(adapter.getSnapshot().incident.errorRatePercent, 1.1);
  assert.equal(adapter.getSnapshot().capabilities.at(-1).availability, "complete");
  assert.equal(adapter.getSnapshot().confirmation, "unobserved");
  assert.equal(adapter.getSnapshot().activity.at(-1).source, "curb-event");
  assert.equal(adapter.getSnapshot().errorSamples.at(-1).rate, 1.1);
});

test("the prepared room connector refuses an unjoined room before importing a transport", async () => {
  await assert.rejects(connectLiveDashboard({ state: "disconnected" }), /Join the authorized Curb LiveKit room/);
});
