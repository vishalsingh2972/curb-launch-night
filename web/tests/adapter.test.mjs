import assert from "node:assert/strict";
import { test } from "node:test";
import { createPreviewAdapter, previewSnapshot } from "../src/preview.ts";

test("preview scenes match the agent's initial, verified and recovered incident values", () => {
  const initial = previewSnapshot("initial");
  assert.equal(initial.incident.serviceHealth, "degraded");
  assert.equal(initial.incident.currentDeployment, "v2.4.1");
  assert.equal(initial.incident.errorRatePercent, 37.2);
  assert.equal(initial.incident.operatorVerified, false);
  assert.equal(initial.capabilities.at(-1).availability, "locked");
  const verified = previewSnapshot("verified");
  assert.equal(verified.incident.operatorVerified, true);
  assert.equal(verified.incident.errorRatePercent, 37.2);
  assert.equal(verified.incident.currentDeployment, "v2.4.1");
  assert.equal(verified.capabilities.at(-1).availability, "available");
  const recovered = previewSnapshot("recovered");
  assert.equal(recovered.incident.serviceHealth, "healthy");
  assert.equal(recovered.incident.currentDeployment, "v2.4.0");
  assert.equal(recovered.incident.errorRatePercent, 1.1);
  assert.equal(recovered.capabilities.at(-1).availability, "complete");
  assert.deepEqual(initial.errorSamples, [{ minute: 4 / 60, rate: 37.2 }]);
  assert.deepEqual(recovered.errorSamples, [{ minute: 4 / 60, rate: 37.2 }, { minute: 28 / 60, rate: 1.1 }]);
});

test("scene changes notify once, unsubscribe works, and reset is deterministic", () => {
  const adapter = createPreviewAdapter();
  const initial = adapter.getSnapshot();
  assert.equal(adapter.getSnapshot(), initial, "snapshot identity is stable for React");
  let notifications = 0;
  const unsubscribe = adapter.subscribe(() => { notifications++; });
  adapter.selectScene("verified");
  adapter.selectScene("verified");
  assert.equal(notifications, 1);
  adapter.selectScene("recovered");
  adapter.selectScene("initial");
  assert.equal(notifications, 3);
  assert.deepEqual(adapter.getSnapshot(), initial);
  unsubscribe();
  adapter.selectScene("recovered");
  assert.equal(notifications, 3);
});

test("adapters are independent, fixtures are labeled, and events remain chronological", () => {
  const first = createPreviewAdapter();
  const second = createPreviewAdapter();
  first.selectScene("recovered");
  assert.equal(second.getSnapshot().revision, "initial");
  const snapshot = first.getSnapshot();
  assert.equal(snapshot.source, "preview");
  assert.ok(snapshot.activity.every((event) => event.source === "preview-fixture"));
  const offsets = snapshot.activity.map((event) => event.offset);
  assert.deepEqual(offsets, [...offsets].sort());
  assert.ok(snapshot.activity.some((event) => event.kind === "confirmation_pending"));
  assert.equal(snapshot.errorSamples.at(-1).rate, snapshot.incident.errorRatePercent);
  assert.equal("verifyOperator" in first, false);
  assert.equal("executeRollback" in first, false);
});
