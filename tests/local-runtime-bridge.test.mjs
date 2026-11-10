import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { mkdir, open, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { register } from "tsx/esm/api";
import { createLocalBridge, DASHBOARD_ORIGIN, LOCAL_BRIDGE_PORT } from "../scripts/local-bridge.mjs";

register({ tsconfig: fileURLToPath(new URL("./tsconfig.json", import.meta.url)) });
const { AgentSiteRuntime, AgentSession } = await import("curb");
const { App } = await import("../src/agent/agent.tsx");
const tokenFile = fileURLToPath(new URL("../.curb/.env.local-bridge-token", import.meta.url));
const sessionId = "preview-33333333-3333-4333-8333-333333333333";
const base = `http://127.0.0.1:${LOCAL_BRIDGE_PORT}`;

async function current() {
  const response = await fetch(`${base}/sessions/${sessionId}`, { headers: { Origin: DASHBOARD_ORIGIN } });
  return response.ok ? response.json() : null;
}
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const state = await current();
    if (state && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Actual Curb runtime snapshot did not reach the local bridge.");
}

test("actual Curb preview runtime publishes initial, tool and confirmed-recovery state", async (t) => {
  const token = "runtime-test-private-token-with-at-least-32-bytes";
  const server = createLocalBridge({ token });
  try {
    server.listen(LOCAL_BRIDGE_PORT, "127.0.0.1");
    await once(server, "listening");
  } catch (error) {
    if (error?.code === "EADDRINUSE") { t.skip("A local mirror is already running; do not disturb its token or session."); return; }
    throw error;
  }
  let tokenOwned = false;
  try {
    await mkdir(fileURLToPath(new URL("../.curb/", import.meta.url)), { recursive: true });
    let handle;
    try { handle = await open(tokenFile, "wx", 0o600); }
    catch (error) { if (error?.code === "EEXIST") { t.skip("A local mirror token already exists; do not overwrite it."); return; } throw error; }
    tokenOwned = true;
    await handle.writeFile(`${token}\n`);
    await handle.close();
    const runtime = new AgentSiteRuntime(createElement(App));
    runtime.bindCall({ sessionId });
    const initial = await waitFor((state) => state.sequence === 0);
    assert.equal(initial.incident.errorRatePercent, 37.2);
    assert.equal(initial.incident.operatorVerified, false);
    await runtime.callTool("check_metrics", {});
    await runtime.callTool("inspect_logs", {});
    const investigated = await waitFor((state) => state.sequence === 2);
    assert.deepEqual(investigated.recentEvents.map((event) => event.type), ["metrics_checked", "logs_inspected"]);
    await runtime.callTool("verify_operator", { pin: "2468" });
    const authorized = await waitFor((state) => state.sequence === 4);
    assert.equal(authorized.incident.operatorVerified, true);
    assert.equal(authorized.incident.currentDeployment, "v2.4.1");
    const responses = [
      { text: "", toolCalls: [{ name: "execute_rollback", input: {} }] },
      { text: "yes", toolCalls: [] },
      { text: "The simulated checkout is healthy.", toolCalls: [] },
    ];
    const session = new AgentSession(runtime, async () => responses.shift());
    await session.runTurn("Roll back the simulated checkout.");
    assert.equal(session.pendingConfirmation?.toolName, "execute_rollback");
    assert.equal((await current()).incident.errorRatePercent, 37.2, "held action never publishes recovered state");
    await session.runTurn("Yes, confirm.");
    const done = await waitFor((state) => state.sequence === 6);
    assert.equal(done.incident.currentDeployment, "v2.4.0");
    assert.equal(done.incident.serviceHealth, "healthy");
    assert.equal(done.incident.errorRatePercent, 1.1);
    assert.deepEqual(done.recentEvents.slice(-2).map((event) => event.type), ["rollback_executed", "service_recovered"]);
    assert.equal(runtime.snapshot().context.tools.some((tool) => tool.name === "execute_rollback"), false);
  } finally {
    if (tokenOwned) await unlink(tokenFile);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
