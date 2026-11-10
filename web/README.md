# Launch Night web shell

A separate React + TypeScript + Vite dashboard. It is a display-only **UI Preview Mode**, with deterministic fixtures and no connection to the Curb agent, model providers or LiveKit.

Step 5B adds a separate prepared Live Mode adapter and a waiting screen at `/?mode=live`. The page still starts no connection or call. See [the integration notes](../docs/live-dashboard.md) for the supported connector, actual event contract and missing hosted/session prerequisites.

From the repository root (install from inside the frontend folder):

```bash
cd web
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Vite uses a strict port so it fails clearly rather than taking Curb's port. The existing agent still starts with `npm run dev` at **http://127.0.0.1:4000** in a different terminal.

## Preview scenes

The development-only scene selector switches between Initial, Verified and Recovered. Switching back to Initial resets the display. There are no timers, random events, provider calls or backend commands.

- Initial: degraded Checkout API, v2.4.1, 37.2% errors; rollback locked.
- Verified: same degraded metrics, operator verification illustrated; rollback available with caller confirmation still required.
- Recovered: healthy, v2.4.0, 1.1% errors; rollback complete and unavailable.

The scene selector is excluded from production builds. All builds retain explicit preview labeling. Activity items, the chart, verification state and capability availability are fixtures, not real agent events or the model's actual tool list. The code panel is an illustrative simplification, not an LLM request inspector. The voice area has no call controls or simulated conversation.

The activity feed is chronological and scrollable, with fixture events for investigation, verification, a historical pending confirmation, and recovery. The recovered scene records that confirmation as subsequently approved; the preview does not implement approval behavior.

## Display adapter

`src/adapter.ts` defines `DashboardAdapter`, `DashboardSnapshot`, typed capability names, activity event kinds, chart samples and data provenance. Its incident shape reuses the backend's `IncidentState` type. `src/preview.ts` reuses only the pure initial incident data and constructs independent UI fixtures; it never imports the agent store or invokes verification/rollback handlers.

The React view subscribes with `useSyncExternalStore`. `src/live.ts` now maps versioned agent events and a read-only snapshot into display state, with a separate waiting/error path and no fixture fallback. `src/connect.ts` prepares `connectAgent` for an already-joined room; obtaining and joining that room is not implemented. Recovery remains authoritative in the agent. The live confirmation lifecycle remains unobserved until a documented session-event source is connected. Inspect real model inputs with Curb's native inspector.

## Validation

```bash
npm --prefix web run typecheck
npm --prefix web run test
npm --prefix web run build
```

The frontend has deterministic preview and live-adapter tests. They use Node 22's built-in experimental type stripping, with no added test library. `build` also runs TypeScript checking. `npm --prefix web run preview` serves the production bundle at http://127.0.0.1:4173 without development scene controls.

Styles use CSS grids, system font stacks, inline SVG and reduced-motion support. No hosted fonts, image services, chart library, animation framework or UI library is needed. The primary desktop target is a 16:9 recording, with a stacked layout on narrower screens.
