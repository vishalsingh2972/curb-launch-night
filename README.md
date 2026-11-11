# Launch Night

Launch Night is a Curb.js 1.17.0 voice incident copilot using KugelAudio's default providers. Curb runs the real voice conversation, renders the agent's React context and conditionally exposes `execute_rollback` after per-session operator verification. Its built-in confirmation holds the simulated rollback until the caller approves it.

**Real:** Curb voice, model tool calls, skill loading, agent state transitions, confirmation, and local application events. **Synthetic:** Checkout API metrics, logs, the fictional operator PIN, deployment rollback, HTTP health response, and incident data. No checkout traffic, payment, monitoring, cloud, or deployment APIs are used.

The [Local Live Mirror](docs/local-live-mirror.md) at `web/` shows real events from the selected Curb preview session. Its Agent X-Ray reflects agent-reported state; Curb's native Context inspector is the authoritative view of model-visible tools. The local HTTP health probe returns 503 before recovery and 200 afterward from the bridge's validated session mirror. A Markdown incident report is downloadable only after recorded rollback and recovery events. Offline **UI Preview Mode** uses labeled fixtures; it is separate from Local Live Mirror. The dashboard does not join the voice room. Hosted browser voice integration remains separate; see [live dashboard notes](docs/live-dashboard.md).

For the three-terminal recording setup and spoken sequence, use the [recording runbook](docs/recording-runbook.md).

## Local preview

Keep the existing development server running; source changes reload automatically. If it is stopped:

```bash
npm run dev
```

`npm run dev` prewarms Curb's agent initialization before starting the native preview, so a slow Windows cold start does not consume Curb's fixed 60-second agent-child deadline. It then runs the installed Curb CLI on port 4000. If Curb itself times out, the launcher performs at most one clean retry and reports a failure if that also times out. It never edits source files or runs a model turn. Stop it with Ctrl+C; it refuses a duplicate preview on port 4000.

Open http://127.0.0.1:4000 only after the terminal reports **Agent: agent** and **Voice: ready**. Existing KugelAudio authentication is unchanged. On a new machine, use `npx curb login` and complete browser sign-in without copying a key.

## Demo flow

1. A new session starts with Checkout API degraded on v2.4.1, 37.2% errors, and previous stable deployment v2.4.0.
2. The agent can open `/incident-response` with Curb's built-in `read_skill`. Only the skill's routing description is present initially; its runbook is loaded on demand. The runbook guides metrics, log inspection, deployment comparison, likely cause and evidence-based recovery recommendations.
3. Request a rollback. The initial application tools are the investigation tools and `verify_operator`; Curb also supplies runtime tools such as `read_skill`. `execute_rollback` is absent until verification.
4. Supply fictional demo PIN **2468**. `verify_operator` compares it in code and updates only this session. This public PIN demonstrates a state gate, not real authentication.
5. Request rollback after verification. React now renders `execute_rollback` with Curb's built-in `confirm` callback. Curb holds the action and reads back: "Confirm the simulated Checkout API rollback from v2.4.1 to v2.4.0?"
6. Say yes on a later turn to execute, or no to cancel. An unclear answer leaves the action pending. The real handler independently checks current verification, then changes only this session's demo deployment to v2.4.0, health to healthy, and errors to 1.1%.
7. Recheck metrics and logs. Historical failure entries remain labeled as history; recovery entries are added. The rollback tool disappears after recovery. A cancellation leaves deployment and metrics unchanged.

The fictional PIN is supplied by the operator; the preview's suggested prompts and Try form do not prefill its value. Curb's native conversation record may still show the operator-supplied tool input, so keep that part of a recorded call private. The custom dashboard, app events and incident report never include the PIN. Verification alone does not execute rollback. Recovery authorization remains at agent level and in the store handler, independent of the skill's loading lifecycle.

Curb's session owns pending confirmations and asks its configured LLM to classify the caller's later answer. The application contains no manual yes/no parser. A direct runtime `callTool` (including a preview tool's Try form) tests the handler directly; it does not simulate the conversation confirmation. Use conversation chat or voice to demonstrate confirmation.

Start a new conversation to reset the incident. Preview hot reload may preserve an existing conversation's state.

## Code map

- `src/incident/simulation.ts`: pure demo data, metrics/log snapshots, verification and rollback transitions.
- `src/incident/store.ts`: Curb `createAgentStore` definition; Curb allocates independent state/actions per runtime. Handlers use `get()` to read current state.
- `src/agent/incident-context.tsx`: changing instructions, live incident context, and conditional Curb tools.
- `src/agent/agent.tsx`: copilot identity, greeting, default providers and preview suggestions.
- `src/agent/incident-response/skill.tsx`: filesystem-discovered, on-demand incident runbook and routing metadata.
- `src/scenarios/*.scenario.ts`: four scripted Curb model scenarios, with real simulation handlers and transcript/state assertions.
- `tests/incident.test.mjs`: deterministic renderer, handler, session confirmation and skill lifecycle tests. Session tests supply a local scripted transport; no provider is called.

## Checks

```bash
npm run check
npm run typecheck
npm run test
```

`npm run test` runs `test:deterministic` using Node's built-in test runner and the already installed tsx loader. Curb's source is included in `tests/tsconfig.json` for its JSX transform. Importing the four scenario definitions validates them without running them. The skill lifecycle unit test uses Curb's real `read_skill` and a small semantic test host; `curb check` verifies production filesystem discovery and rendering.

## Model scenarios (paid; run only when separately authorized)

```bash
npx curb test investigation
npx curb test unauthorized-recovery
npx curb test src/scenarios/authorized-recovery.scenario.ts
npx curb test cancelled-recovery
```

The authorized command uses its full relative path because a substring filter of `authorized-recovery` also matches `unauthorized-recovery`. Run all four with `npx curb test` when authorized. These commands call the configured KugelAudio model, including confirmation classification. No scenario fakes verification or rollback: their real session state changes are asserted through fresh metrics and transcript records.

Investigation and unauthorized recovery forbid rollback attempts. Authorized recovery requires a held action followed by execution on a later affirmative confirmation. Cancelled recovery requires a held action, a negative confirmation, no executed rollback, and unchanged metrics.

The free checks above do not call a paid model. The final voice and screen-recording acceptance sequence is in the recording runbook; it must be performed manually in a fresh Curb preview session. No hosted deployment is part of the local demo.

The version-matched framework guide is in `node_modules/curb/docs/agent-guide/`. `AGENTS.md` contains coding guidance; `.mcp.json` retains the starter's KugelAudio MCP configuration. Secrets and generated runtime/conversation files remain ignored by Git.
