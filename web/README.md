# Launch Night dashboard

A React + TypeScript + Vite display for the synthetic checkout incident. **Local Live Mirror** at `/?mode=local` receives validated app snapshots and backend events from the selected Curb native-preview session through the loopback bridge. Its Agent X-Ray, capability list and activity feed reflect that session's reported state. The read-only Checkout Health Probe makes a real local HTTP GET; the post-incident Markdown report uses observed backend events. Neither authorizes an operator, executes rollback, joins the voice room, nor shows the compiled model tool manifest. Curb's native Context inspector is authoritative for model-visible tools.

**UI Preview Mode** at `/` remains an offline fixture display. The separate `/?mode=live` waiting view is preparation for hosted access; it does not start a call. See [the local mirror guide](../docs/local-live-mirror.md), [recording runbook](../docs/recording-runbook.md) and [hosted integration notes](../docs/live-dashboard.md).

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

The scene selector is excluded from production builds. All builds retain explicit preview labeling. Activity items, the chart, verification state and capability availability in this mode are fixtures, not real agent events or the model's actual tool list. Agent X-Ray includes a clearly abbreviated source illustration, not an LLM request inspector. The voice area has no call controls or simulated conversation.

The activity feed is chronological and scrollable, with fixture events for investigation, verification, a historical pending confirmation, and recovery. The recovered scene records that confirmation as subsequently approved; the preview does not implement approval behavior.

## Display adapter

`src/adapter.ts` defines `DashboardAdapter`, `DashboardSnapshot`, typed capability names, activity event kinds, chart samples and data provenance. Its incident shape reuses the backend's `IncidentState` type. `src/preview.ts` reuses only the pure initial incident data and constructs independent UI fixtures; it never imports the agent store or invokes verification/rollback handlers.

The React view subscribes with `useSyncExternalStore`. `src/live.ts` maps versioned agent events and a read-only snapshot into display state, with a separate waiting/error path and no fixture fallback. `src/local-mirror.ts` binds that adapter to one selected preview session. `src/health-probe.ts` performs a bounded GET only when that session's health or deployment changes or when the user presses its probe button. `src/incident-report.ts` formats a download only after observed rollback and service-recovery events for the selected connected session. Recovery remains authoritative in the agent. The confirmation lifecycle is not in the app-event stream; inspect the native preview for confirmation and exact model inputs. `src/connect.ts` remains preparation for hosted access to an already-joined room.

## Validation

```bash
npm --prefix web run typecheck
npm --prefix web run test
npm --prefix web run build
```

The frontend has deterministic preview and live-adapter tests. They use Node 22's built-in experimental type stripping, with no added test library. `build` also runs TypeScript checking. `npm --prefix web run preview` serves the production bundle at http://127.0.0.1:4173 without development scene controls.

The interface uses a two-part incident/runtime composition, CSS grids, inline SVG, and reduced-motion support. It reuses the already-installed Inter variable font with only its Latin asset; no font service or new package is required. Agent X-Ray connects reported state to an abbreviated illustration of the real JSX gate, and its count covers the four application tools, not Curb's complete model manifest.

Use `?view=present` with either the offline route or `?mode=local&view=present` for the optional recording view. The in-page Detailed/Presentation toggle uses `history.replaceState`; it keeps the selected adapter/session mounted. Presentation emphasizes service health, rollback status, recent events and the actual probe response. Show advanced details restores the complete view. Short session labels retain the full identity in a tooltip and advanced details. The report still uses its original real-event gate; offline fixtures have no HTTP result or downloadable real report. The recording runbook includes the manual screenshot matrix and safe native-preview cropping guidance.

`presentation.ts` permits emphasis only for new observed backend events in the same connected session. Selecting a session, reconnecting, duplicate events, or unknown state never replay a recovery/unlock effect. UI Preview Mode may illustrate transitions with its clearly labeled fixtures. The chart plots at most six actual observations from the adapter, with relative timestamps and no interpolated traffic. The report sits below the main recording area.

At 1920×1080 the incident and X-Ray share the primary row, with activity, tools and probe beneath. At 1366×768 the same composition allows intentional vertical scrolling; below 1100px it stacks for side-by-side recording. Keep a face-camera overlay in the outer margin or footer. Browser screenshot QA was blocked by the unavailable browser access host during this pass; check your exact crop before recording.
