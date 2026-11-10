# Launch Night

Live telemetry preparation is documented in [docs/live-dashboard.md](docs/live-dashboard.md). Actual agent transitions emit Curb app messages, and the frontend has a tested read-only adapter; joining an authorized live room remains a separate step.

The separate display-only dashboard lives in [`web/`](web/README.md). Run `npm --prefix web run dev` for UI Preview Mode on port 5173; Curb's native preview remains on port 4000. Frontend scene controls select fixtures and never authorize agent actions.

Launch Night is an AI incident copilot built with Curb.js 1.17.0 and its default KugelAudio providers. React renders the model context and tools. All checkout metrics, logs, operator verification and rollback actions are synthetic demo data; no monitoring or deployment APIs are contacted.

## Local preview

Keep the existing development server running; source changes reload automatically. If it is stopped:

```bash
npm run dev
```

Open http://127.0.0.1:4000. Existing KugelAudio authentication is unchanged. On a new machine, use `npx curb login` and complete browser sign-in without copying a key.

## Demo flow

1. A new session starts with Checkout API degraded on v2.4.1, 37.2% errors, and previous stable deployment v2.4.0.
2. The agent can open `/incident-response` with Curb's built-in `read_skill`. Only the skill's routing description is present initially; its runbook is loaded on demand. The runbook guides metrics, log inspection, deployment comparison, likely cause and evidence-based recovery recommendations.
3. Request a rollback. Initially only the investigation tools and `verify_operator` exist; rollback requires verification.
4. Supply fictional demo PIN **2468**. `verify_operator` compares it in code and updates only this session. This public PIN demonstrates a state gate, not real authentication.
5. Request rollback after verification. React now renders `execute_rollback` with Curb's built-in `confirm` callback. Curb holds the action and reads back: "Confirm the simulated Checkout API rollback from v2.4.1 to v2.4.0?"
6. Say yes on a later turn to execute, or no to cancel. An unclear answer leaves the action pending. The real handler independently checks current verification, then changes only this session's demo deployment to v2.4.0, health to healthy, and errors to 1.1%.
7. Recheck metrics and logs. Historical failure entries remain labeled as history; recovery entries are added. The rollback tool disappears after recovery. A cancellation leaves deployment and metrics unchanged.

The PIN is also prefilled in the preview tool's Try form; that value is not included in the model's tool schema. Verification alone does not execute rollback. Recovery authorization remains at agent level and in the store handler, independent of the skill's loading lifecycle.

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

Conversational behavior, spoken PIN recognition and voice timing still need a separately authorized real conversation. No dashboard or deployment is part of this step.

The version-matched framework guide is in `node_modules/curb/docs/agent-guide/`. `AGENTS.md` contains coding guidance; `.mcp.json` retains the starter's KugelAudio MCP configuration. Secrets and generated runtime/conversation files remain ignored by Git.
