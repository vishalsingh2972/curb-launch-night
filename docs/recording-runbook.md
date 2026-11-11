# Launch Night recording runbook

This is a localhost screen recording of a **real Curb native voice call** and a separate **Local Live Mirror**. The Checkout API incident and its metrics are synthetic. The dashboard mirrors the selected preview session's backend events; it does not join the voice room or authorize actions.

## Start three terminals

Use three Git Bash terminals in the repository root, in this order. Keep all three open:

```bash
npm run bridge:local
```

```bash
npm run dev
```

```bash
cd web && npm run dev
```

Open **http://127.0.0.1:4000** for the Curb native voice preview and **http://127.0.0.1:5173/?mode=local** for the dashboard. Open the voice preview in a normal browser window so microphone access works. The dashboard's `/` URL is **UI Preview Mode** with fixtures; do not use it for the live take.

For a 1920×1080 capture, keep the native preview's Context inspector visible for the tool-visibility shots and show the dashboard alongside it or as a separate full-screen cut. Keep the dashboard's top metrics and **Agent capabilities** uncovered. Put a small face-camera overlay over the lower-right voice placeholder or an outer margin. At 1366×768, use separate cuts of the preview and dashboard if side-by-side windows make tool names hard to read. Keep browser zoom at a readable setting and check the exact crop in your recorder.

## Fresh take and session selection

1. Start the bridge before a new conversation. In Curb preview, use the conversation title menu and **New conversation**. This gives the incident a fresh agent store and session ID.
2. In the dashboard's **Local Live Mirror**, choose the newly listed `preview-…` session in **Curb preview session**. A fresh bridge with one new conversation is easiest to identify. If several sessions appear, match the full session ID and latest activity; do not assume the first entry is the active call.
3. Check the dashboard reads **37.2%**, **v2.4.1**, **Degraded**, and `execute_rollback` **Locked**. The Curb Context panel is the authoritative proof that the tool is absent from the model's actual context.
4. Start the voice call in the native preview. The mirror only displays events from the selected session.

## Spoken sequence

Speak naturally and wait for each response/tool action before the next line:

1. “Our checkout service is failing. Can you investigate?” Watch for real `check_metrics` and `inspect_logs` feed entries and, if opened, the incident-response skill in Curb.
2. “Can you roll back the deployment?” The agent should require operator verification. `execute_rollback` should still be absent in Curb Context.
3. “Verify me with the fictional demo PIN 2468.” Wait for **Operator verified** and **Recovery capability unlocked** in the mirror. The rollback row changes **Locked → Available**. Check that Curb Context now lists `execute_rollback`.
4. “Please perform the simulated rollback now.” Curb should hold the action and ask for its built-in confirmation. The mirror does **not** show a pending-confirmation state; that lifecycle is not streamed reliably.
5. Answer “Yes, confirm the simulated rollback.” The backend handler should execute only after this answer.
6. “What is the checkout status now?” Check **v2.4.0**, **Healthy**, and **1.1%** in the voice response and dashboard. The activity feed should show **Rollback completed** and **Service recovered**. The rollback capability row now reads **Unavailable**, and Curb Context should no longer list the tool.

The exact phrasing may vary with the model. If it does not use a tool, do not manufacture a dashboard event; ask a short follow-up and capture what actually happened. Do not show the fictional PIN in a published transcript or captured tool arguments.

## Screen moments to capture

- **Before verification:** red degraded dashboard and locked rollback row beside Curb Context with `execute_rollback` absent.
- **After verification:** the real verification and unlock events, green **Available** row, and `execute_rollback` present in Curb Context.
- **Confirmation held:** Curb's spoken confirmation prompt before rollback has executed; the dashboard still shows v2.4.1 and 37.2%.
- **Tool executed:** Curb's tool result after the spoken yes.
- **Recovered:** dashboard changes to green 1.1%, healthy, v2.4.0; activity lists rollback/recovery; capability returns to **Unavailable** and the tool disappears from Curb Context.

## Save the call before reloading

After the take, use the preview's synchronized **call replay** control to download the full WAV. Save your screen recording as well. Curb records the transcript, tool calls, context and store state in ignored `.data/conversations.jsonl`; `npx curb conversations --last 1` can read the latest conversation. The preview can also download a model input as JSON or use **Copy for coding agent**. Keep these files private because they can contain spoken details and tool arguments.

**Download the call WAV before editing `src/` or `context/` or restarting the preview.** Curb's installed preview documentation says finished-call audio and synchronized replay do not survive an agent reload, even though the recorded conversation and store state do. Copy the WAV to a separate recording folder before resetting for another take.

## Reset and troubleshoot

For another take, select **New conversation** in the Curb preview, then select its new session ID in the dashboard. Do not rewind or continue a recovered conversation when you need the initial outage state. The session selector only changes what the dashboard watches. If identity is ambiguous, restart the bridge to clear its in-memory list, start a new preview conversation, and select the one new session.

If `npm run dev` intermittently reports a startup timeout around 60 seconds on Windows, check whether the terminal later prints the ready URL and whether **http://127.0.0.1:4000** loads. If it has exited, leave the bridge and web server running and restart only the Curb preview with `npm run dev`. Avoid duplicate Curb processes on port 4000. Do not change Node, Curb, providers or authentication for this transient startup issue.

If the mirror disconnects, check that the bridge terminal is still running and listening on `127.0.0.1:4187`, the dashboard is at `/?mode=local`, and the selected session ID matches the active Curb conversation. Reload the dashboard or reselect that session; its snapshot should restore the current incident state if the bridge retained it. If the bridge restarted and lost its in-memory session, start a **new** preview conversation after it is running. A bridge failure must not block Curb's real tools, but values on a disconnected dashboard are stale and should not be filmed as live.

Hosted browser voice still requires the account-gated hosted session flow and is outside this local recording path. See [Local Live Mirror](local-live-mirror.md) for bridge details.
