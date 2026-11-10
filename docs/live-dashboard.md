# Step 5B: live dashboard preparation

Real simulated-agent actions now produce Curb app messages. A tested display adapter can consume them. This step does **not** create a hosted endpoint, obtain credentials, join a room, start a call or attach to the native preview. Curb stays at 1.17.0 with KugelAudio providers.

## Event contract

`src/incident/events.ts` defines two application message keys:

- **`launch-night.event.v1`**, agent → client: `{ version: 1, simulated: true, streamId, sequence, elapsedMs, type, incident }`.
- **`launch-night.snapshot.v1`**, client → agent: exactly `{ version: 1 }`. Its read-only reply is `{ version: 1, simulated: true, streamId, sequence, incident, recentEvents }`.

| Event type | Actual source |
| --- | --- |
| `metrics_checked` | Successful synthetic metrics read |
| `logs_inspected` | Successful synthetic log inspection |
| `operator_verification_succeeded` | Existing agent PIN validator returned success |
| `operator_verification_failed` | Existing validator rejected an attempted demo PIN |
| `recovery_capability_unlocked` | Operator changed from unverified to verified during the active incident |
| `rollback_executed` | Actual rollback handler changed the simulated deployment |
| `service_recovered` | That transition made Checkout API healthy at 1.1% errors |

The incident shape is the actual `IncidentState`. Version 1 validates this simulator's fixed deployments/health/error values; update the contract and tests if those change. Every runtime owns its stream ID, sequence and bounded journal of the last **12** events. Every payload is a fresh state copy. No PIN, transcript, raw logs, personal identifier, API key or room credential is included. Event size and journal bounds are tested against Curb's documented 16 KB app-message limit.

The real store actions record events. Their Curb tool handlers publish with `useSend().toClient`. Rendering, snapshot requests and offline scene buttons emit no business event. Malformed tool input rejected by Curb's schema never reaches the validator. Re-verifying an already verified operator emits success without another unlock; blocked/already-completed rollback emits no duplicate recovery.

This telemetry is **not** a full audit log, compiled model input or proof that a model called a tool. Curb's native Try form directly invokes handlers, so it can also produce actual simulation transitions. Use Curb's native inspector for model verification.

## Authorization and confirmation

The only `useMessage` handler is a read-only snapshot request from `client`, with a strict version-only schema. It accepts no authorization fields or commands. There are no app-message handlers for verification or rollback. Altering the UI or sending a forged event to the agent cannot change its store. The real `connectAgent` client validates the sending agent participant; payload validation checks coherence, not authorization.

The conditional JSX tool and independent backend verification guard remain. Curb's existing `<Tool confirm={...}>` is unchanged: a held, declined or unclear question does not execute the rollback handler and emits no recovery event. Display-delivery failure never converts an already-successful recovery into a failed/retryable tool.

No manual yes/no parser was added. This contract does **not** stream pending/declined/approved confirmation notifications. Live Mode reports confirmation as `unobserved`, never inferring approval from verification or recovery state. A later documented session-event source may add those notifications without replacing Curb's confirmation mechanism.

## Frontend

Start the existing frontend from `web/` with `npm run dev`:

- **http://127.0.0.1:5173/** — separate offline UI Preview Mode and development fixture selector.
- **http://127.0.0.1:5173/?mode=live** — Live Mode setup, waiting for an authorized session. No fake metrics or verification are displayed. Opening this URL starts no connection or call.

`web/src/live.ts` exposes `createLiveAdapter(client?)`, consuming the documented `on`/`ask` subset of `curb/client`. It listens before asking for a snapshot, reconciles racing events, deduplicates by stream/sequence, ignores malformed/other-session events and reads another snapshot after gaps. Synchronization errors are visible. It retains at most 100 activity events and plots only reported metrics/recovery observations, never the preview's invented 15-minute history. Late joins recover current state plus the bounded journal, not full call history.

Close the adapter on disconnect. It unsubscribes, ignores late replies and marks capabilities unknown; remaining values are explicitly last received. A new call needs a new adapter. There are no verification, rollback or scene-selection methods on the live adapter.

`web/src/connect.ts` provides **`connectLiveDashboard(room, { agentIdentity? })`**, using real `connectAgent` only on an already-connected LiveKit room. It returns `{ adapter, close }`. Cleanup stops telemetry and responds to room disconnect; it does not end the caller-owned call. The existing root Curb installation supplies the supported API; no second framework or unrelated dependency was installed in `web/`.

**The current page deliberately does not invoke that connector.** A future authorized bootstrap must join the room, call the helper and pass its adapter to the existing `Dashboard` view in `main.tsx` instead of the waiting adapter. Create/clean up that connection in an effect with cleanup or a deliberate user action, never during a React render initializer. If the caller app already owns a `connectAgent(room)` client, pass it to `createLiveAdapter(existingClient)` instead: LiveKit allows one handler per topic, so do not create a second Curb client for the same room.

## Missing pieces and exact next steps

1. **Approved hosting and a session endpoint.** For KugelAudio, obtain Agents access for the organization and an activated deployment containing these changes. Configure a public endpoint for the intended dashboard origin. Confirm allowed-origin rules, including localhost support, using the enabled account's documentation. Nothing in this step is deployed.
2. **The actual Session API contract.** The installed `connecting.md` names `POST /v1/agents/public/endpoints/{id}/sessions` but directs readers to the hosted docs for its actual address and request/response. Reading that official page during this step returned “This page is for accounts with Agents enabled / Sign in to read it.” No guessed API base URL, request payload, endpoint ID, proxy route or placeholder credential is implemented.
3. **Authorized room credentials and identity.** Obtain the room connection information and browser-scoped join credential from the approved session flow, plus agent identity if needed. Keep credentials in memory. Never put a platform API key, runner bearer token or join ticket in source, browser environment variables, localStorage, query strings or chat. A room token is not a platform API key.
4. **A caller-owned browser bootstrap and audio lifecycle.** After an explicit call action and the host's consent/recording requirements, join the actual returned room. Call `connectLiveDashboard(joinedRoom, options)`, render its adapter, and manage the microphone, audio and call-end lifecycle. Share the caller's room instead of creating an unrelated dashboard room. The session bootstrap, audio controls and call-end flow remain unimplemented.
5. **Separately authorized model/voice validation with credits.** Investigate, try a wrong PIN, verify with the demo PIN, request rollback, decline once, then request and approve. Compare dashboard state against Curb's native inspector. Room join, real message delivery, audio and real-model confirmation classification remain unverified.

An approved self-hosted option likewise needs a real LiveKit room, scoped tokens and a host running Curb. No Docker/database/hosting stack was added. **localhost:4000 is an independent native preview, not a public Session API or a documented credential source for this dashboard.** No bridge route was invented. Hosted runner management endpoints and bearer tokens are private to the host and must never reach the browser. The hosted widget's public start/end/context methods do not promise access to its room; do not rely on widget internals.

## Verification without paid calls

Run `npm run check`, `npm run typecheck`, `npm run test` in the repository root; run `npm run build`, `npm run test` in `web/`.

Tests bridge real Curb `useSend`/`useMessage` and actual simulator actions to the live adapter entirely in memory. They cover confirmation with a scripted transport, rejected client mutations, session isolation, payload hygiene, late joins, gaps, duplicates and cleanup. No scenario runner, paid model, room connection or deployment was invoked. Calls with no client may log Curb's documented dropped-message warning; the snapshot path recovers current state later. Such a warning is not successful delivery to `web/`.

## Sources

Installed Curb 1.17.0: `app-messages.md`, `hooks/use-message.md`, `hooks/use-send.md`, `client.md`, `connecting.md`, `host-protocol.md`, `web-calls.md` and public API/type definitions. The official [hosted Session API page](https://docs.kugelaudio.com/hosted-agents/native-apps) is account-gated; that is why implementation stops before the real call bootstrap.
