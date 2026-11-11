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

For a 1920×1080 capture, keep the native preview's Context inspector visible for the tool-visibility shots and show the dashboard alongside it or as a separate full-screen cut. Keep the dashboard's top metrics, **Agent capabilities**, **Agent X-Ray**, and **Checkout Health Probe** uncovered. Put a small face-camera overlay in an outer margin or over the footer, not over status panels. At 1366×768, use separate cuts of the preview and dashboard if side-by-side windows make tool names hard to read. Keep browser zoom at a readable setting and check the exact crop in your recorder. The Incident Report button sits lower in the activity panel and can be shown in a closing cut.

## Fresh take and session selection

### Presentation view and recording crop

Use **http://127.0.0.1:5173/?mode=local&view=present** for the recording composition. The **Detailed / Presentation** buttons update only the URL and layout; the selected adapter and session stay mounted. **Show advanced details** restores the observation chart, full tool list, explanations, and full selected-session reference. The detailed route remains **http://127.0.0.1:5173/?mode=local**. Offline equivalents are **http://127.0.0.1:5173/** and **http://127.0.0.1:5173/?view=present**.

Presentation view prioritizes service health, error rate, deployment, the React gate, recent real activity and the actual HTTP response. The report area reserves its space before recovery and only enables a real download when the existing observed-event gate passes. The 160×90 space beside it is reserved for a small face-camera overlay on wide views; it is hidden on narrow screens. Offline fixtures never run an HTTP probe or enable a real-session report.

For a 1920×1080 recording, use the dashboard full-screen for the transformation, or allocate roughly 1280px to the presentation dashboard and 640px to a separate native Curb preview window. If the native Context list is too small in that arrangement, record it as a separate full-width proof shot before and after verification. At 1366×768, prefer separate dashboard and native-preview cuts over squeezing both panes. Use 100% browser zoom for the first crop check.

Keep the native preview's tool-input and transcript details outside the public crop: they can reveal the fictional PIN. Capture the Context tool names and confirmation interaction, and crop or edit out sensitive tool arguments. Do not alter Curb's own UI to hide them.

### Manual screenshot QA still required

Automated browser access was unavailable during this pass. No viewport screenshot or measured overflow result is claimed. At **both 1920×1080 and 1366×768 viewport sizes, 100% zoom**, capture:

1. Offline **Initial**, **Verified**, and **Recovered** in Presentation view using the labeled fixture controls; capture Initial and Recovered once more in Detailed view. These prove visual layout only; the offline HTTP/report areas must say no real result is available.
2. Local Live Mirror with **no session selected** (unknown), in both views. If a loading state is visible during a genuine selection, capture it without inserting a fake delay.
3. During your authorized real test, the same selected session **before verification**, **after verification**, and **after recovery** in Presentation view. Include the actual HTTP 503/200 result and unavailable/available report button. Capture the recovered Detailed view too.
4. After ending the call and saving its WAV, stop only the bridge and capture the **disconnected** mirror in both views. Current metrics, X-Ray and HTTP claims must become unknown, and report download must be disabled; retained activity must remain labeled recorded history. Restart the bridge and use a new conversation for another take.
5. At a narrow viewport (about 900px, practical side-by-side width), confirm readable stacked panels. At about 390px, confirm no horizontal scrollbar and wrapped controls.

For every screenshot, check `scrollWidth` versus the visible viewport if your browser's tools are available, and inspect the right edge for clipping. Verify the service values, X-Ray rollback label, probe and recent activity are inside the intended crop. At 1366×768, intentional vertical scrolling is acceptable; capture a separate lower-panel/report shot if needed. Check long session IDs in Detailed view, the full-ID tooltip in Presentation view, and **Show advanced details**. Toggle views during a selected session and confirm it stays selected without replaying an unlock/recovery highlight. Also check reduced-motion browser emulation if available.

### Select a fresh session

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
6. “What is the checkout status now?” Check **v2.4.0**, **Healthy**, and **1.1%** in the voice response and dashboard. The activity feed should show **Rollback completed** and **Service recovered**. The rollback capability row now reads **Removed**, and Curb Context should no longer list the tool.

The exact phrasing may vary with the model. If it does not use a tool, do not manufacture a dashboard event; ask a short follow-up and capture what actually happened. Do not show the fictional PIN in a published transcript or captured tool arguments.

## Screen moments to capture

- **Before verification:** red degraded dashboard and locked rollback row beside Curb Context with `execute_rollback` absent.
- **After verification:** the real verification and unlock events, green **Available** row, and `execute_rollback` present in Curb Context.
- **Confirmation held:** Curb's spoken confirmation prompt before rollback has executed; the dashboard still shows v2.4.1 and 37.2%.
- **Tool executed:** Curb's tool result after the spoken yes.
- **Recovered:** dashboard changes to green 1.1%, healthy, v2.4.0; activity lists rollback/recovery; capability returns to **Removed** and the tool disappears from Curb Context.

## Final manual acceptance checklist

Use **one fresh real voice session**; this checklist is for the operator, not an automated model test.

1. New selected session shows degraded Checkout API, v2.4.1 and 37.2% synthetic errors.
2. Checkout Health Probe returns **HTTP 503**.
3. Incident Report download is unavailable.
4. Real `check_metrics` and `inspect_logs` calls appear in activity after investigation.
5. Successful verification changes Agent X-Ray and unlocks `execute_rollback`; confirm it appears in Curb Context.
6. The health probe remains **HTTP 503** after verification.
7. Incident Report download remains unavailable.
8. Curb holds the requested rollback and asks for confirmation; the dashboard does not claim to have observed approval.
9. Explicit spoken approval allows the real rollback handler to execute.
10. Dashboard changes to healthy, v2.4.0 and 1.1% synthetic errors.
11. Health probe returns **HTTP 200** for the same selected session.
12. `execute_rollback` disappears from Curb's active Context panel and reads **Removed** in the dashboard.
13. Incident Report download becomes available for that session only.
14. Downloaded Markdown contains the observed relative event timeline and synthetic labels, with no PIN, credentials, token or invented approval event.

## Save the call before reloading

After the take, use the preview's synchronized **call replay** control to download the full WAV. Save your screen recording as well. Curb records the transcript, tool calls, context and store state in ignored `.data/conversations.jsonl`; `npx curb conversations --last 1` can read the latest conversation. The preview can also download a model input as JSON or use **Copy for coding agent**. Keep these files private because they can contain spoken details and tool arguments.

**Download the call WAV before editing `src/` or `context/` or restarting the preview.** Curb's installed preview documentation says finished-call audio and synchronized replay do not survive an agent reload, even though the recorded conversation and store state do. Copy the WAV to a separate recording folder before resetting for another take.

## Reset and troubleshoot

For another take, select **New conversation** in the Curb preview, then select its new session ID in the dashboard. Do not rewind or continue a recovered conversation when you need the initial outage state. The session selector only changes what the dashboard watches. If identity is ambiguous, restart the bridge to clear its in-memory list, start a new preview conversation, and select the one new session.

`npm run dev` now prewarms the actual Curb agent initialization before starting the native preview. A cold prewarm can take over a minute on this laptop; that time is outside Curb's fixed 60-second child-start deadline. Wait for **Agent: agent** and **Voice: ready**, not only for the preview URL. If Curb still hits the deadline, the launcher stops it and retries once without touching source. A second timeout exits with an error; keep its diagnostics and do not record against a failed preview. The launcher pins port 4000 and refuses a duplicate process instead of silently opening 4001. Stop it with Ctrl+C after the take. Do not change Node, Curb, providers or authentication.

If the mirror disconnects, check that the bridge terminal is still running and listening on `127.0.0.1:4187`, the dashboard is at `/?mode=local`, and the selected session ID matches the active Curb conversation. Reload the dashboard or reselect that session; its snapshot should restore the current incident state if the bridge retained it. If the bridge restarted and lost its in-memory session, start a **new** preview conversation after it is running. A bridge failure must not block Curb's real tools, but values on a disconnected dashboard are stale and should not be filmed as live.

The optional bridge runtime integration test skips while the bridge is running or its generated token file exists. To run it, wait until **no voice conversation is active**, stop only the bridge with Ctrl+C, and verify port 4187 is no longer listening. If `.curb/.env.local-bridge-token` remains from that stopped bridge, remove only that generated file. Then run `npm run test:bridge:runtime` from the repository root. The test creates and removes its own token; restart `npm run bridge:local` afterward and start a new preview conversation. Do not stop a bridge during a live take to satisfy this test.

Hosted browser voice still requires the account-gated hosted session flow and is outside this local recording path. See [Local Live Mirror](local-live-mirror.md) for bridge details.
