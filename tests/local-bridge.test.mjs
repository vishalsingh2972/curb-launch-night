import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createLocalBridge, DASHBOARD_ORIGIN } from "../scripts/local-bridge.mjs";
import { createInitialIncident } from "../src/incident/simulation.ts";

const token = "test-only-private-token-with-at-least-32-bytes";
const first = "preview-11111111-1111-4111-8111-111111111111";
const second = "preview-22222222-2222-4222-8222-222222222222";
const recovered = { ...createInitialIncident(), operatorVerified: true, currentDeployment: "v2.4.0", serviceHealth: "healthy", errorRatePercent: 1.1, incidentStatus: "resolved" };
const verified = { ...createInitialIncident(), operatorVerified: true };

function event(streamId, sequence, type, incident) {
  return { version: 1, simulated: true, streamId, sequence, elapsedMs: sequence * 1000, type, incident };
}
function snapshot(streamId, incident = createInitialIncident(), recentEvents = []) {
  return { version: 1, simulated: true, streamId, sequence: recentEvents.at(-1)?.sequence ?? 0, incident, recentEvents };
}
function ingest(base, sessionId, value, headers = {}) {
  return fetch(`${base}/ingest`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    body: JSON.stringify({ version: 1, sessionId, snapshot: value }),
  });
}
const streamBuffers = new WeakMap();
async function nextIncident(reader) {
  const state = streamBuffers.get(reader) ?? { text: "", queued: [], decoder: new TextDecoder() };
  streamBuffers.set(reader, state);
  while (!state.queued.length) {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    state.text += state.decoder.decode(value, { stream: true });
    while (state.text.includes("\n\n")) {
      const end = state.text.indexOf("\n\n");
      const block = state.text.slice(0, end);
      state.text = state.text.slice(end + 2);
      if (block.startsWith("event: incident\n")) state.queued.push(JSON.parse(block.split("\ndata: ")[1]));
    }
  }
  return state.queued.shift();
}

test("loopback bridge authenticates backend, streams ordered events per session, and rejects fake recovery", async () => {
  const server = createLocalBridge({ token });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const abort = new AbortController();
  try {
    const initialOne = snapshot("stream-one");
    assert.equal((await ingest(base, first, initialOne, { Origin: DASHBOARD_ORIGIN })).status, 403, "browser POST is refused even with a token");
    assert.equal((await fetch(`${base}/ingest`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${base}/sessions`, { headers: { Origin: "http://evil.invalid" } })).status, 403);
    assert.equal((await ingest(base, first, initialOne)).status, 202);
    const stream = await fetch(`${base}/sessions/${first}/events`, { headers: { Origin: DASHBOARD_ORIGIN }, signal: abort.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    assert.equal((await ingest(base, second, snapshot("stream-two"))).status, 202);
    const metrics = event("stream-one", 1, "metrics_checked", createInitialIncident());
    const firstUpdate = snapshot("stream-one", createInitialIncident(), [metrics]);
    assert.equal((await ingest(base, first, firstUpdate)).status, 202);
    assert.deepEqual(await nextIncident(reader), metrics, "the first session stream did not receive the second session's events");
    assert.equal((await ingest(base, first, firstUpdate)).status, 200, "duplicate is idempotent");
    assert.equal((await ingest(base, first, initialOne)).status, 200, "stale snapshot cannot rewind state");
    const secondEvents = [event("stream-two", 1, "operator_verification_succeeded", verified), event("stream-two", 2, "recovery_capability_unlocked", verified)];
    assert.equal((await ingest(base, second, snapshot("stream-two", verified, secondEvents))).status, 202);
    const fakeRecovery = snapshot("stream-two", recovered, [...secondEvents, event("stream-two", 3, "service_recovered", recovered)]);
    assert.equal((await ingest(base, second, fakeRecovery)).status, 409, "recovery needs the real rollback event before service recovery");
    const oneEvents = [metrics, event("stream-one", 2, "operator_verification_succeeded", verified), event("stream-one", 3, "recovery_capability_unlocked", verified)];
    assert.equal((await ingest(base, first, snapshot("stream-one", verified, oneEvents))).status, 202);
    assert.equal((await nextIncident(reader)).type, "operator_verification_succeeded");
    assert.equal((await nextIncident(reader)).type, "recovery_capability_unlocked");
    const recoveryEvents = [...oneEvents, event("stream-one", 4, "rollback_executed", recovered), event("stream-one", 5, "service_recovered", recovered)];
    assert.equal((await ingest(base, first, snapshot("stream-one", recovered, recoveryEvents))).status, 202);
    assert.equal((await nextIncident(reader)).type, "rollback_executed");
    assert.equal((await nextIncident(reader)).type, "service_recovered");
    const current = await fetch(`${base}/sessions/${first}`, { headers: { Origin: DASHBOARD_ORIGIN } });
    assert.equal((await current.json()).incident.errorRatePercent, 1.1);
    const other = await fetch(`${base}/sessions/${second}`, { headers: { Origin: DASHBOARD_ORIGIN } });
    assert.equal((await other.json()).incident.errorRatePercent, 37.2);
    await reader.cancel();
  } finally {
    abort.abort();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("health probe reflects only validated per-session state and never accepts browser state", async () => {
  const server = createLocalBridge({ token });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const probe = (sessionId) => fetch(`${base}/sessions/${sessionId}/health`, { headers: { Origin: DASHBOARD_ORIGIN } });
  try {
    const missing = await probe(first);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { version: 1, simulated: true, health: "unknown", error: "session_not_found" });
    assert.equal((await ingest(base, first, snapshot("stream-one"))).status, 202);
    assert.equal((await ingest(base, second, snapshot("stream-two"))).status, 202);

    const degraded = await probe(first);
    assert.equal(degraded.status, 503);
    const degradedBody = await degraded.json();
    assert.deepEqual({ simulated: degradedBody.simulated, health: degradedBody.health, deployment: degradedBody.deployment },
      { simulated: true, health: "degraded", deployment: "v2.4.1" });
    assert.equal(degradedBody.sessionId, first);
    assert.ok(Number.isFinite(Date.parse(degradedBody.observedAt)));
    assert.equal((await probe(second)).status, 503);

    const verifiedEvents = [event("stream-one", 1, "operator_verification_succeeded", verified), event("stream-one", 2, "recovery_capability_unlocked", verified)];
    assert.equal((await ingest(base, first, snapshot("stream-one", verified, verifiedEvents))).status, 202);
    assert.equal((await probe(first)).status, 503, "verification is not recovery");
    const fake = await fetch(`${base}/sessions/${first}/health`, {
      method: "POST", headers: { Origin: DASHBOARD_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ health: "healthy", deployment: "v2.4.0", operatorVerified: true }),
    });
    assert.equal(fake.status, 403);
    assert.equal((await fetch(`${base}/sessions/${first}/health?health=healthy&deployment=v2.4.0`, { headers: { Origin: DASHBOARD_ORIGIN } })).status, 400);
    assert.equal((await fetch(`${base}/sessions/${first}/health`, { headers: { Origin: "http://evil.invalid" } })).status, 403);
    assert.equal((await probe(first)).status, 503, "probe reads never change incident state");

    const recoveryEvents = [...verifiedEvents, event("stream-one", 3, "rollback_executed", recovered), event("stream-one", 4, "service_recovered", recovered)];
    assert.equal((await ingest(base, first, snapshot("stream-one", recovered, recoveryEvents))).status, 202);
    const healthy = await probe(first);
    assert.equal(healthy.status, 200);
    const healthyBody = await healthy.json();
    assert.deepEqual({ simulated: healthyBody.simulated, health: healthyBody.health, deployment: healthyBody.deployment, errorRatePercent: healthyBody.errorRatePercent },
      { simulated: true, health: "healthy", deployment: "v2.4.0", errorRatePercent: 1.1 });
    assert.doesNotMatch(JSON.stringify(healthyBody), /2468|KUGELAUDIO_API_KEY/);
    assert.equal((await probe(second)).status, 503, "session B must retain its own degraded state");
    assert.equal((await (await fetch(`${base}/sessions/${first}`, { headers: { Origin: DASHBOARD_ORIGIN } })).json()).incident.incidentStatus, "resolved");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
