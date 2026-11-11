# Local Live Mirror for the launch recording

The Curb native preview remains the **real voice call** at `http://127.0.0.1:4000`. The separate dashboard at `http://127.0.0.1:5173/?mode=local` mirrors actual, per-call incident snapshots and events. It does not join the LiveKit room, carry audio, or alter verification and rollback. UI Preview Mode (`/`) and future Hosted Live Mode (`/?mode=live`) remain separate.

In three Git Bash terminals, from this repository:

```bash
npm run bridge:local
npm run dev
cd web && npm run dev
```

On Windows PowerShell, use `npm.cmd` instead of `npm` if script execution is disabled. Start the bridge before a **new** native preview conversation. Open the Curb preview in your normal browser, then the dashboard's Local Live Mirror URL. After the preview starts its new conversation, choose the `preview-…` session in the dashboard selector. A fresh bridge has an empty session list, so the single newly listed session is the safest choice. If several sessions exist, select the one just created and identified by its full preview session ID and latest activity; restart the bridge and start a new conversation to clear ambiguity. Selecting a session changes only what the dashboard watches.

The first snapshot comes from the agent's `useEffect` after Curb binds `useSession().call.sessionId`; it is not produced during render or by a UI fixture. The agent's real tool handlers then post their store's sequenced snapshot after each action. The bridge filters by Curb's preview session ID, validates the existing incident contract and transition order, and forwards genuine events through SSE. Late subscribers read the current snapshot. The dashboard never sends verification or rollback commands.

Expected voice-demo visuals:

1. The selected new session shows Checkout API degraded, v2.4.1, 37.2% errors and locked rollback. These values come from that call's actual agent store.
2. Asking the agent to investigate adds `check_metrics` and `inspect_logs` activity only when those handlers execute.
3. Giving the fictional demo PIN and asking the agent to verify adds a successful verification and unlock event only after the backend validator succeeds. The PIN is absent from bridge payloads.
4. Requesting rollback triggers Curb's built-in confirmation in the **voice preview**. The mirror does not claim confirmation is pending because this app-event contract cannot observe that lifecycle reliably.
5. After the caller affirms and the real rollback handler succeeds, the mirror changes to v2.4.0, healthy and 1.1% errors, adds rollback/recovery activity and marks rollback complete. A declined or unclear confirmation emits no recovery event.

The bridge binds only `127.0.0.1:4187`. Browser reads require origin `http://127.0.0.1:5173`. Backend ingestion requires a random bearer token written to ignored `.curb/.env.local-bridge-token` (also blocked by Vite's default `.env.*` file deny rule), refuses any browser `Origin` header, and never exposes that token to the dashboard. The bridge keeps at most 20 in-memory sessions. No KugelAudio login token or API key is used. If the bridge is unavailable, the agent still completes tools; the dashboard shows a disconnected or unknown state. Restarting the bridge clears its mirror history; start a new preview conversation for an unambiguous recording.

This is a localhost recording aid. Hosted browser voice sessions still require KugelAudio's account-gated Session API, a deployed agent and a configured public endpoint. The local mirror does not satisfy that hosted integration and should never be presented as the dashboard joining the voice room.

## Synthetic checkout health probe

Restart the bridge after updating its code, then start a **new** Curb preview conversation and select its session in the dashboard. Local Live Mirror shows a read-only **Checkout Health Probe** panel. Its button sends only a GET to the bridge. A new probe also runs when the selected, connected session's reported health or deployment changes; verification alone does not trigger one. The panel shows unknown on bridge disconnection instead of treating its last result as current.

The endpoint is `GET http://127.0.0.1:4187/sessions/<preview-session-id>/health`. It requires the dashboard browser origin, as do other bridge reads. For a manual Git Bash check, replace the placeholder with the full session ID shown in the dashboard selector:

```bash
curl -i -H 'Origin: http://127.0.0.1:5173' 'http://127.0.0.1:4187/sessions/<preview-session-id>/health'
```

The initial synthetic incident returns **HTTP 503**, `health: "degraded"`, `deployment: "v2.4.1"`. Successful verification alone leaves it at 503. After Curb's confirmed rollback handler publishes its recovered snapshot, the **same URL** returns **HTTP 200**, `health: "healthy"`, `deployment: "v2.4.0"`. The body also identifies the simulated mirror and when the bridge accepted its snapshot. An unknown session returns HTTP 404 with `health: "unknown"`. The bridge cannot observe whether an otherwise quiet Curb voice call has hung up; this endpoint reports its last accepted session snapshot, not independent production liveness. The dashboard marks results unknown if its bridge connection is lost. No checkout requests or payments are processed.
