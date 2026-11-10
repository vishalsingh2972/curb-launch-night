import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { register } from "tsx/esm/api";

// Curb ships TSX source; include it in the automatic JSX transform, as its CLI does.
register({ tsconfig: fileURLToPath(new URL("./tsconfig.json", import.meta.url)) });
const { Agent, AgentSession, AgentSiteRuntime, Instruction, Skill, Skills, Tool, createSkillRoutes } = await import("curb");
const { App } = await import("../src/agent/agent.tsx");
const { IncidentContext } = await import("../src/agent/incident-context.tsx");
const { useIncident } = await import("../src/incident/store.ts");
const { createInitialIncident, executeRollback } = await import("../src/incident/simulation.ts");
const { INCIDENT_EVENT_KEY, INCIDENT_SNAPSHOT_KEY, isIncidentEvent, isIncidentSnapshot } = await import("../src/incident/events.ts");

// Direct runtime calls test handlers; confirmation is enforced by AgentSession, tested below.
// No test invokes a provider. Session tests inject queued, deterministic transport responses.
const runtime = () => new AgentSiteRuntime(createElement(App));
const names = (r) => r.snapshot().context.tools.map((tool) => tool.name);
const context = (r) => r.snapshot().stateSnapshot.join("\n");
const call = async (r, name, input = {}) => (await r.callTool(name, input)).result;

test("initial context exposes investigation and verification, with rollback absent", async () => {
  const r = runtime();
  assert.deepEqual(names(r).filter((name) => !["skip_turn", "read_skill"].includes(name)).sort(),
    ["check_metrics", "inspect_logs", "verify_operator"]);
  assert.match(context(r), /Recovery is locked/);
  assert.equal(`${r.snapshot().context.systemPrompt}\n${context(r)}`.includes("execute_rollback"), false);
  const metrics = await call(r, "check_metrics");
  assert.equal(metrics.ok, true);
  assert.deepEqual(metrics.data, {
    simulated: true,
    source: "Launch Night synthetic demo data",
    window: "simulated latest 60 seconds",
    ...createInitialIncident(),
  });
  const logs = await call(r, "inspect_logs");
  assert.equal(logs.data.simulated, true);
  assert.ok(logs.data.entries.some((entry) => entry.deployment === "v2.4.1" && entry.message.includes("POST /checkout 500")));
  await assert.rejects(r.callTool("execute_rollback"), /not available/);
});

test("incorrect, missing and malformed PINs cannot unlock recovery", async () => {
  const r = runtime();
  for (const input of [{ pin: "0000" }, {}, { pin: "yes" }, { pin: 2468 }]) {
    assert.equal((await call(r, "verify_operator", input)).ok, false);
    assert.equal(names(r).includes("execute_rollback"), false);
    assert.equal((await call(r, "check_metrics")).data.operatorVerified, false);
  }
});

test("valid PIN re-renders the tool surface; rollback updates context, metrics and logs", async () => {
  const r = runtime();
  assert.equal((await call(r, "verify_operator", { pin: "2468" })).ok, true);
  assert.equal(names(r).includes("execute_rollback"), true);
  assert.match(context(r), /Recovery is available/);
  // Verification alone must not roll back.
  assert.equal((await call(r, "check_metrics")).data.currentDeployment, "v2.4.1");
  const result = await call(r, "execute_rollback");
  assert.equal(result.ok, true);
  assert.equal(result.data.currentDeployment, "v2.4.0");
  assert.equal(result.data.serviceHealth, "healthy");
  assert.equal(result.data.errorRatePercent, 1.1);
  assert.equal(result.data.incidentStatus, "resolved");
  assert.equal(result.data.operatorVerified, true);
  assert.deepEqual((await call(r, "check_metrics")).data, result.data);
  assert.equal(names(r).includes("execute_rollback"), false);
  assert.match(context(r), /Report the simulated recovery/);
  assert.match(context(r), /Error rate: 1\.1%/);
  const logs = (await call(r, "inspect_logs")).data;
  assert.equal(logs.currentDeployment, "v2.4.0");
  assert.equal(logs.serviceHealth, "healthy");
  assert.equal(logs.errorRatePercent, 1.1);
  assert.ok(logs.entries.some((entry) => entry.level === "ERROR"));
  assert.match(logs.entries.at(-1).message, /1\.1%/);
});

test("the actual store action refuses rollback even when the JSX gate is bypassed", async () => {
  // A test-only tool deliberately bypasses the production JSX gate and calls the same action.
  function BypassProbe() {
    const rollback = useIncident((state) => state.executeRollback);
    return createElement(Tool, {
      name: "attempt_bypass",
      description: "Test only: invoke the store action directly.",
      onSubmit: rollback,
    });
  }
  const r = new AgentSiteRuntime(createElement(Agent, null, createElement(IncidentContext), createElement(BypassProbe)));
  assert.equal((await call(r, "attempt_bypass")).ok, false);
  assert.deepEqual((await call(r, "check_metrics")).data, {
    simulated: true,
    source: "Launch Night synthetic demo data",
    window: "simulated latest 60 seconds",
    ...createInitialIncident(),
  });
  await call(r, "verify_operator", { pin: "2468" });
  assert.equal((await call(r, "execute_rollback")).ok, true);
  const recovered = (await call(r, "check_metrics")).data;
  // Repeated calls through a retained handler are harmless after recovery.
  assert.equal((await call(r, "attempt_bypass")).ok, true);
  assert.deepEqual((await call(r, "check_metrics")).data, recovered);
});

test("verification and recovery never leak between runtimes", async () => {
  const first = runtime();
  const second = runtime();
  await call(first, "verify_operator", { pin: "2468" });
  await call(first, "execute_rollback");
  assert.equal(names(second).includes("execute_rollback"), false);
  assert.equal((await call(second, "check_metrics")).data.operatorVerified, false);
  assert.equal((await call(second, "check_metrics")).data.currentDeployment, "v2.4.1");
  assert.equal((await call(second, "check_metrics")).data.errorRatePercent, 37.2);
  const third = runtime();
  assert.equal(names(third).includes("execute_rollback"), false);
});

test("the pure rollback guard rejects an unverified state, even if already resolved", () => {
  const state = createInitialIncident();
  assert.equal(executeRollback(state).result.ok, false);
  assert.deepEqual(executeRollback(state).state, state);
  assert.equal(executeRollback({ ...state, incidentStatus: "resolved" }).result.ok, false);
});

function scriptedSession(r, responses) {
  const queue = [...responses];
  const requests = [];
  const session = new AgentSession(r, async (request) => {
    requests.push(request);
    assert.ok(queue.length, "unexpected transport request");
    return queue.shift();
  });
  return { session, requests, remaining: () => queue.length };
}

const requestRollback = { text: "", toolCalls: [{ name: "execute_rollback", input: {} }] };
const response = (text) => ({ text, toolCalls: [] });
const rollbackQuestion = "Confirm the simulated Checkout API rollback from v2.4.1 to v2.4.0?";

test("the Curb session holds rollback, then runs the real handler only after a later yes", async () => {
  const r = runtime();
  await call(r, "verify_operator", { pin: "2468" });
  assert.equal(r.confirms("execute_rollback"), true);
  const { session, requests, remaining } = scriptedSession(r, [requestRollback, response("yes"), response("Simulated recovery completed.")]);
  assert.equal(await session.runTurn("Roll back the simulated checkout."), rollbackQuestion);
  assert.equal(session.pendingConfirmation?.toolName, "execute_rollback");
  assert.equal((await call(r, "check_metrics")).data.currentDeployment, "v2.4.1");
  assert.equal((await call(r, "check_metrics")).data.errorRatePercent, 37.2);
  await session.runTurn("Yes, roll back.");
  // The queued verdict is a transport stub, not application yes/no parsing.
  assert.equal(requests[1].skillTitle, "confirmation");
  assert.equal(requests[1].tools.length, 0);
  assert.equal(session.pendingConfirmation, null);
  assert.equal(remaining(), 0);
  assert.equal((await call(r, "check_metrics")).data.currentDeployment, "v2.4.0");
  assert.equal((await call(r, "check_metrics")).data.errorRatePercent, 1.1);
  assert.equal(names(r).includes("execute_rollback"), false);
  assert.ok(session.messages.some((message) => message.role === "assistant" &&
    message.toolCalls?.some((tool) => tool.name === "execute_rollback" && tool.confirmedBy === "Yes, roll back.")));
});

test("a declined Curb confirmation cancels without changing deployment or metrics", async () => {
  const r = runtime();
  await call(r, "verify_operator", { pin: "2468" });
  const before = (await call(r, "check_metrics")).data;
  const { session, remaining } = scriptedSession(r, [requestRollback, response("no"), response("Cancelled. The simulated deployment is unchanged.")]);
  await session.runTurn("Roll back checkout.");
  assert.equal(session.pendingConfirmation?.readBack, rollbackQuestion);
  await session.runTurn("No, cancel the rollback.");
  assert.equal(session.pendingConfirmation, null);
  assert.equal(remaining(), 0);
  assert.deepEqual((await call(r, "check_metrics")).data, before);
  assert.equal(names(r).includes("execute_rollback"), true);
  assert.equal(session.messages.some((message) => message.role === "tool" &&
    message.toolName === "execute_rollback" && message.result.ok), false);
});

test("an unclear Curb confirmation keeps the action pending without executing", async () => {
  const r = runtime();
  await call(r, "verify_operator", { pin: "2468" });
  const { session, remaining } = scriptedSession(r, [requestRollback, response("unclear"), response("Do you want the simulated rollback?")]);
  await session.runTurn("Roll back checkout.");
  await session.runTurn("Maybe, tell me more.");
  assert.equal(session.pendingConfirmation?.toolName, "execute_rollback");
  assert.equal(remaining(), 0);
  assert.equal((await call(r, "check_metrics")).data.currentDeployment, "v2.4.1");
  assert.equal((await call(r, "check_metrics")).data.errorRatePercent, 37.2);
});

test("incident runbook loads through Curb read_skill; unloading it does not remove authorization", async () => {
  const module = await import("../src/agent/incident-response/skill.tsx");
  const routes = createSkillRoutes({
    "./incident-response/skill.tsx": module,
    // Test-only second skill makes LRU eviction observable with a one-skill window.
    "./other/skill.tsx": { default: () => createElement(Instruction, null, "Another test topic."), meta: { description: "Use for the other test topic." } },
  });
  // A tiny test host supplies the semantic page boundaries used by Curb's host.
  // Production uses filesystem discovery and <Agent>'s loader, checked by `curb check`.
  // There is no substitute read_skill handler: that tool belongs to AgentSiteRuntime.
  const r = new AgentSiteRuntime(({ loadedPaths }) => createElement(Agent, null,
    createElement(Skills, null, ...routes.map((route) => createElement(Skill,
      { key: route.path, path: route.path, description: route.meta.description }, route.meta.title ?? route.path))),
    createElement(IncidentContext),
    ...loadedPaths.map((path) => {
      const route = routes.find((entry) => entry.path === path);
      return createElement("agent-page", { key: path, path, title: route.meta.title ?? path }, createElement(route.Component));
    }),
  ), { maxLoadedSkills: 1 });
  assert.equal(context(r).includes("Checkout incident runbook"), false);
  assert.ok(r.snapshot().context.links.some((link) => link.to === "/incident-response" && link.description === module.meta.description));
  assert.equal(names(r).includes("execute_rollback"), false);
  assert.equal((await call(r, "read_skill", { skill: "/incident-response" })).ok, true);
  assert.match(context(r), /Checkout incident runbook/);
  assert.equal(r.snapshot().context.path, "/incident-response");
  assert.equal(names(r).includes("execute_rollback"), false);
  await call(r, "verify_operator", { pin: "2468" });
  await call(r, "read_skill", { skill: "/other" });
  assert.equal(context(r).includes("Checkout incident runbook"), false);
  assert.equal(names(r).includes("execute_rollback"), true);
  assert.equal(r.confirms("execute_rollback"), true);
  assert.equal((await call(r, "check_metrics")).data.operatorVerified, true);
  await call(r, "read_skill", { skill: "/incident-response" });
  assert.match(context(r), /Checkout incident runbook/);
  assert.equal((await call(r, "check_metrics")).data.operatorVerified, true);
  const appSource = await readFile(new URL("../src/agent/agent.tsx", import.meta.url), "utf8");
  assert.match(appSource, /<Skill path="\/incident-response">/);
  assert.equal(appSource.includes("Checkout incident runbook"), false);
});

test("all four paid scenarios are valid definitions and keep simulation handlers real", async () => {
  for (const name of ["investigation", "unauthorized-recovery", "authorized-recovery", "cancelled-recovery"]) {
    // Importing scenario() definitions validates them; this never runs a conversation.
    const { default: scenario } = await import(`../src/scenarios/${name}.scenario.ts`);
    assert.equal(scenario.name, name);
    assert.ok(scenario.turns.length > 0);
    assert.equal(scenario.fakes, undefined);
    assert.equal(typeof scenario.expect, "function");
  }
});

test("scenario assertions reject early, unconfirmed or faked rollback execution", async () => {
  const { rollbacksFollowConfirmation } = await import("../src/scenarios/assertions.ts");
  const verified = { turn: 2, confirmation: null, toolCalls: [{ name: "verify_operator", ok: true, input: { pin: "2468" } }] };
  const held = { turn: 3, confirmation: null, toolCalls: [{ name: "execute_rollback", ok: false, heldFor: rollbackQuestion }] };
  const confirmed = {
    turn: 4,
    confirmation: { tool: "execute_rollback", readBack: rollbackQuestion, verdict: "yes", ran: true },
    toolCalls: [{ name: "execute_rollback", ok: true }],
  };
  assert.equal(rollbacksFollowConfirmation([verified, held, confirmed]), true);
  assert.equal(rollbacksFollowConfirmation([verified, held]), false);
  assert.equal(rollbacksFollowConfirmation([held, confirmed]), false);
  assert.equal(rollbacksFollowConfirmation([verified, confirmed]), false);
  assert.equal(rollbacksFollowConfirmation([verified, held, { ...confirmed, turn: 3 }]), false);
  assert.equal(rollbacksFollowConfirmation([verified, held, { ...confirmed, confirmation: null }]), false);
  assert.equal(rollbacksFollowConfirmation([verified, held, { ...confirmed, confirmation: { ...confirmed.confirmation, verdict: "no", ran: false } }]), false);
  assert.equal(rollbacksFollowConfirmation([verified, held, { ...confirmed, toolCalls: [{ name: "execute_rollback", ok: true, faked: true }] }]), false);
});

function captureEvents(r) {
  const events = [];
  r.messages.connectClient(({ key, payload }) => {
    assert.equal(key, INCIDENT_EVENT_KEY);
    assert.equal(isIncidentEvent(payload), true);
    events.push(payload);
    return "sent";
  });
  return events;
}
const readDashboard = async (r, payload = { version: 1 }) =>
  (await r.messages.deliver("client", { key: INCIDENT_SNAPSHOT_KEY, id: "test-snapshot", payload })).reply;

test("actual tool calls emit sanitized sequenced messages and a read-only late-join snapshot", async () => {
  const r = runtime();
  const events = captureEvents(r);
  const initial = await readDashboard(r);
  assert.equal(initial.sequence, 0);
  assert.equal(isIncidentSnapshot(initial), true);
  await call(r, "check_metrics");
  await call(r, "inspect_logs");
  await call(r, "verify_operator", { pin: "0000" });
  await call(r, "verify_operator", { pin: "2468" });
  await call(r, "verify_operator", { pin: "2468" });
  assert.deepEqual(events.map((event) => event.type), ["metrics_checked", "logs_inspected", "operator_verification_failed", "operator_verification_succeeded", "recovery_capability_unlocked", "operator_verification_succeeded"]);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6]);
  assert.ok(events.every((event) => event.streamId === initial.streamId && JSON.stringify(event).length < 2048));
  assert.equal(JSON.stringify(events).includes("2468"), false);
  assert.equal(JSON.stringify(events).includes("0000"), false);
  const snapshot = await readDashboard(r);
  assert.equal(snapshot.incident.operatorVerified, true);
  assert.equal(isIncidentSnapshot(snapshot), true);
  snapshot.incident.operatorVerified = false;
  assert.equal((await readDashboard(r)).incident.operatorVerified, true, "reply does not expose mutable backend state");
  for (let i = 0; i < 15; i++) await call(r, "check_metrics");
  assert.equal((await readDashboard(r)).recentEvents.length, 12);
  assert.equal(isIncidentSnapshot(await readDashboard(r)), true);
  assert.ok(new TextEncoder().encode(JSON.stringify(await readDashboard(r))).length < 16 * 1024);
});

test("client app messages cannot set authorization or execute rollback", async () => {
  const r = runtime();
  captureEvents(r);
  await assert.rejects(readDashboard(r, { version: 1, operatorVerified: true }), (error) => error.code === "invalid_payload");
  await assert.rejects(r.messages.deliver("client", { id: "spoof", key: INCIDENT_EVENT_KEY,
    payload: { type: "operator_verification_succeeded", operatorVerified: true } }), (error) => error.code === "no_handler");
  await assert.rejects(r.messages.deliver("client", { id: "rollback", key: "execute_rollback", payload: {} }), (error) => error.code === "no_handler");
  assert.equal((await readDashboard(r)).incident.operatorVerified, false);
  assert.equal(names(r).includes("execute_rollback"), false);
  const other = runtime();
  captureEvents(other);
  await call(r, "verify_operator", { pin: "2468" });
  assert.notEqual((await readDashboard(r)).streamId, (await readDashboard(other)).streamId);
  assert.equal((await readDashboard(other)).incident.operatorVerified, false);
});

test("rollback messages are emitted after execution, never while confirmation is held or declined", async () => {
  for (const verdict of ["yes", "no"]) {
    const r = runtime();
    const events = captureEvents(r);
    await call(r, "verify_operator", { pin: "2468" });
    events.length = 0;
    const { session } = scriptedSession(r, [requestRollback, response(verdict), response("Done with this simulated request.")]);
    await session.runTurn("Roll back checkout.");
    assert.deepEqual(events, []);
    assert.equal((await readDashboard(r)).incident.currentDeployment, "v2.4.1");
    await session.runTurn(verdict === "yes" ? "Yes, roll back." : "No, cancel.");
    assert.deepEqual(events.map((event) => event.type), verdict === "yes" ? ["rollback_executed", "service_recovered"] : []);
    assert.equal((await readDashboard(r)).incident.currentDeployment, verdict === "yes" ? "v2.4.0" : "v2.4.1");
  }
});

test("actual Curb messages update the live adapter while preview fixtures cannot change agent authorization", async () => {
  const { createLiveAdapter } = await import("../web/src/live.ts");
  const { createPreviewAdapter } = await import("../web/src/preview.ts");
  const r = runtime();
  const listeners = new Set();
  r.messages.connectClient(({ key, payload }) => {
    assert.equal(key, INCIDENT_EVENT_KEY);
    listeners.forEach((listener) => listener(payload));
    return "sent";
  });
  const live = createLiveAdapter({
    on: (key, listener) => { assert.equal(key, INCIDENT_EVENT_KEY); listeners.add(listener); return () => listeners.delete(listener); },
    ask: async (key, payload) => { assert.equal(key, INCIDENT_SNAPSHOT_KEY); return readDashboard(r, payload); },
  });
  await live.ready;
  const preview = createPreviewAdapter();
  preview.selectScene("recovered");
  assert.equal(live.getSnapshot().incident.operatorVerified, false);
  assert.equal((await readDashboard(r)).incident.operatorVerified, false);
  await call(r, "check_metrics");
  await call(r, "inspect_logs");
  await call(r, "verify_operator", { pin: "2468" });
  assert.equal(live.getSnapshot().capabilities.at(-1).availability, "available");
  const { session } = scriptedSession(r, [requestRollback, response("yes"), response("Recovered.")]);
  await session.runTurn("Roll back checkout.");
  assert.equal(live.getSnapshot().incident.currentDeployment, "v2.4.1");
  assert.equal(live.getSnapshot().confirmation, "unobserved", "do not invent a pending confirmation event");
  await session.runTurn("Yes, roll back.");
  assert.equal(live.getSnapshot().incident.errorRatePercent, 1.1);
  assert.equal(live.getSnapshot().incident.currentDeployment, "v2.4.0");
  assert.equal(live.getSnapshot().capabilities.at(-1).availability, "complete");
  assert.ok(live.getSnapshot().activity.every((event) => event.source === "curb-event"));
  assert.equal(live.getSnapshot().activity.at(-1).title, "Service recovered");
  live.close();
  assert.equal(listeners.size, 0);
});

test("display transport failure never changes a successful rollback into a failed tool", async () => {
  const r = runtime();
  captureEvents(r);
  await call(r, "verify_operator", { pin: "2468" });
  r.messages.connectClient(() => { throw new Error("test transport unavailable"); });
  const result = await call(r, "execute_rollback");
  assert.equal(result.ok, true);
  assert.equal((await readDashboard(r)).incident.serviceHealth, "healthy");
});
