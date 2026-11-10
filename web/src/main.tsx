import { StrictMode, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { ActivityKind, DashboardAdapter, DashboardSnapshot, PreviewAdapter, PreviewScene } from "./adapter.ts";
import { createPreviewAdapter } from "./preview.ts";
import { createLiveAdapter } from "./live.ts";
import "./styles.css";

function Icon({ name, size = 18 }: { name: "pulse" | "box" | "shield" | "arrow" | "lock" | "check" | "code" | "mic" | "terminal"; size?: number }) {
  const paths = {
    pulse: <path d="M2 12h4l3-7 5 14 3-7h5" />,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z M3 8v9l9 5 9-5V8 M12 13v9 M7.5 5.5l9 5" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3 M12 14v3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    code: <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" />,
    mic: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8" /></>,
    terminal: <path d="m4 5 6 6-6 6m9 0h7" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function ErrorChart({ snapshot }: { snapshot: DashboardSnapshot }) {
  const { errorSamples, incident } = snapshot;
  if (!incident) return null;
  const preview = snapshot.source === "preview";
  if (!preview && errorSamples.length === 0) return <div className="chart empty-chart">No metrics observations received yet.</div>;
  const recovered = incident.serviceHealth === "healthy";
  const x = (index: number) => 48 + index / Math.max(1, errorSamples.length - 1) * 672;
  const y = (rate: number) => 154 - rate / 50 * 132;
  const points = errorSamples.map((sample, i) => `${x(i)},${y(sample.rate)}`).join(" ");
  return <svg className={`chart ${recovered ? "chart-healthy" : ""}`} viewBox="0 0 752 190" role="img" aria-label={`Synthetic incident error-rate ${preview ? "fixture history over 15 minutes" : "observations reported by the agent"}, ending at ${incident.errorRatePercent} percent.`}>
    <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".17" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
    {[0, 10, 20, 30, 40, 50].map((rate) => <g key={rate}><line className="grid-line" x1="48" x2="720" y1={y(rate)} y2={y(rate)} /><text x="32" y={y(rate) + 4} textAnchor="end">{rate}%</text></g>)}
    <line className="threshold" x1="48" x2="720" y1={y(5)} y2={y(5)} /><text className="threshold-label" x="716" y={y(5) - 6} textAnchor="end">5% threshold</text>
    {preview && <><line className="deploy-line" x1={x(4.5)} x2={x(4.5)} y1="18" y2="154" /><rect className="chart-label-bg" x={x(4.5) - 42} y="1" width="84" height="20" rx="4" /><text className="chart-label" x={x(4.5)} y="14" textAnchor="middle">v2.4.1 deployed</text></>}
    {(preview || errorSamples.length > 1) && <polygon points={`48,154 ${points} 720,154`} fill="url(#chart-fill)" />}
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round" />
    <circle cx={x(errorSamples.length - 1)} cy={y(errorSamples.at(-1)!.rate)} r="4" fill="currentColor" stroke="#14171c" strokeWidth="2" />
    {preview && recovered && <><line className="deploy-line recovery-line" x1={x(10.5)} x2={x(10.5)} y1="21" y2="154" /><text className="recovery-label" x={x(10.5) + 7} y="14">Preview rollback</text></>}
    {preview && [0, 5, 10, 15].map((minute) => <text key={minute} x={x(minute)} y="180" textAnchor="middle">{minute === 15 ? "Now" : `${15 - minute}m ago`}</text>)}
    {!preview && <><text x="48" y="180">Observation 1</text>{errorSamples.length > 1 && <text x="720" y="180" textAnchor="end">Observation {errorSamples.length}</text>}</>}
  </svg>;
}

const eventIcon: Record<ActivityKind, "pulse" | "terminal" | "shield" | "lock" | "check"> = { incident: "pulse", tool_call: "terminal", operator_verified: "shield", verification_failed: "lock", capability_unlocked: "shield", service_recovered: "check", confirmation_pending: "lock", rollback_completed: "check" };

function PreviewControls({ adapter }: { adapter: PreviewAdapter }) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  return <div className="scene-controls"><span className="scene-caption">Preview scene</span><div className="segmented" role="group" aria-label="Development-only preview scene">{(["initial", "verified", "recovered"] as PreviewScene[]).map((scene, i) => <button key={scene} type="button" aria-pressed={snapshot.revision === scene} onClick={() => adapter.selectScene(scene)}><span>{String(i + 1).padStart(2, "0")}</span>{scene[0].toUpperCase() + scene.slice(1)}</button>)}</div></div>;
}

/** Display-only view: the live adapter can replace fixtures without granting UI commands. */
function Dashboard({ adapter, previewControls }: { adapter: DashboardAdapter; previewControls?: ReactNode }) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  const { incident, activity, capabilities } = snapshot;
  const preview = snapshot.source === "preview";
  if (!incident) return <div className="app"><header className="topbar"><a className="brand" href="/"><span className="brand-mark"><span /></span><strong>Launch Night.</strong></a><span className="environment">Simulated Environment</span></header><main><section className="panel live-waiting"><div className="eyebrow">LIVE MODE / CONNECTION PREPARED</div><h1>Waiting for a Curb session.</h1><p>{snapshot.connectionDetail}</p><p>No agent state has been received. Metrics, verification and recovery availability are unknown.</p><p>This page does not attach to the native preview or start a call. A session bootstrap must supply an already-joined LiveKit room to the prepared connector.</p><a href="/">Return to offline UI Preview Mode</a></section></main></div>;
  const recovered = incident.incidentStatus === "resolved";
  const rollback = capabilities.find((capability) => capability.name === "execute_rollback")!;
  const available = capabilities.filter((capability) => capability.availability === "available").length;
  return <div className={`app ${recovered ? "is-recovered" : ""}`}>
    <header className="topbar">
      <a className="brand" href="#main" aria-label="Launch Night command center"><span className="brand-mark"><span /></span><strong>Launch Night<span className="brand-period">.</span></strong></a>
      <div className="header-service"><span className={`status-dot ${recovered ? "green" : "amber"}`} /><span>Checkout API</span><span className="header-slash">/</span><span className="header-health">{incident.serviceHealth}</span></div>
      <div className="header-right"><span className="environment"><span className="tiny-square" />Simulated Environment</span><span className="powered">Built with <strong>curb.js</strong></span></div>
    </header>
    <main id="main">
      <div className="page-heading"><div><div className="eyebrow">COMMAND CENTER <span>/</span> LAUNCH NIGHT</div><h1>AI Incident Copilot<span className="title-dot">.</span></h1><p>A clear view of the incident. A deliberate path to recovery.</p></div><div className={`incident-badge ${recovered ? "healthy-badge" : ""}`}><span className={`status-dot ${recovered ? "green" : "amber"}`} />{recovered ? "Incident resolved" : "Active incident"}<span className="badge-divider" />LN-001</div></div>

      <section className="preview-bar" aria-label="Preview data controls"><div className="preview-copy"><span className="preview-label">{preview ? "UI PREVIEW MODE" : "LIVE MODE"}</span><span>{preview ? "Deterministic fixtures. No agent connected." : snapshot.connection === "connected" ? "Agent-reported events. Incident data remains synthetic." : snapshot.connectionDetail}</span></div>{previewControls}{preview && <a className="live-setup-link" href="?mode=live">Live Mode setup</a>}</section>

      <div className="metrics" aria-live="polite" aria-atomic="true">
        <section className="metric"><div className="metric-label"><Icon name="pulse" size={16} />Error rate<span className="metric-tag">DEMO / 60s</span></div><div className="metric-bottom"><div className={`metric-number ${recovered ? "text-green" : "text-amber"}`}>{incident.errorRatePercent.toFixed(1)}<span>%</span></div><span className="metric-note">{recovered ? "Back below threshold" : "Above 5% threshold"}</span></div></section>
        <section className="metric"><div className="metric-label"><Icon name="box" size={16} />Current deployment</div><div className="metric-bottom"><div className="metric-number deployment-number">{incident.currentDeployment}</div><span className="metric-note">Stable: <code>{incident.previousStableDeployment}</code></span></div></section>
        <section className="metric"><div className="metric-label"><Icon name="shield" size={16} />Service health</div><div className="metric-bottom"><div className={`health-number ${recovered ? "text-green" : "text-amber"}`}><span className={`status-dot ${recovered ? "green" : "amber"}`} />{recovered ? "Healthy" : "Degraded"}</div><span className="metric-note">Checkout API</span></div></section>
      </div>

      <div className="dashboard-grid">
        <section className="panel chart-panel"><div className="panel-heading"><div><h2>Error rate over time</h2><p>{preview ? "Synthetic checkout requests \u00b7 last 15 minutes" : "Agent-reported observations; no fixture history"}</p></div><span className="legend"><span className={`status-dot ${recovered ? "green" : "amber"}`} />Error rate</span></div><ErrorChart snapshot={snapshot} /><div className="chart-footnote"><Icon name={recovered ? "check" : "arrow"} size={14} /><span>{preview ? recovered ? "Preview recovery: errors returned to 1.1% on v2.4.0." : "Errors began immediately after the v2.4.1 deployment." : "Only observations received from this agent session are plotted."}</span><span className="fixture-tag">{preview ? "FIXTURE" : "AGENT DATA"}</span></div></section>

        <section className="panel capability-panel"><div className="panel-heading"><div><h2>Agent capabilities</h2><p>{preview ? "Preview availability; not the model tool list" : "Agent-reported availability; not compiled model input"}</p></div><span className="count-pill">{available} available</span></div><div className="capability-list">{capabilities.map((capability) => <div className={`capability ${capability.name === "execute_rollback" ? `rollback-row ${capability.availability}` : ""}`} key={capability.name}><span className="tool-icon"><Icon name={capability.name === "execute_rollback" ? capability.availability === "locked" ? "lock" : capability.availability === "complete" ? "check" : "arrow" : "terminal"} size={16} /></span><div className="capability-text"><code>{capability.name}</code><p>{capability.description}</p></div><span className={`availability ${capability.availability}`}>{capability.availability === "available" ? "Available" : capability.availability === "locked" ? "Locked" : capability.availability === "unknown" ? "Unknown" : "Complete"}</span></div>)}</div></section>

        <section className="panel activity-panel"><div className="panel-heading"><div><h2>Incident activity</h2><p>A chronological view of the response</p></div><span className="fixture-tag">{preview ? "PREVIEW EVENTS" : "CURB EVENTS"}</span></div><ol className="activity-feed" tabIndex={0} aria-label={preview ? "Synthetic incident activity, earliest first" : "Agent-reported activity, earliest first"}>{activity.map((event) => <li key={event.id} className={`event event-${event.kind}`}><time>+{event.offset}</time><span className="event-symbol"><Icon name={eventIcon[event.kind]} size={14} /></span><div><h3 className={event.kind === "tool_call" ? "mono" : ""}>{event.title}</h3><p>{event.detail}</p></div></li>)}</ol><div className="activity-bottom"><span className="status-dot gray" />{preview ? "Local fixture stream" : "Curb app messages"}<span>{activity.length} events</span></div></section>

        <div className="explanation-stack"><section className="panel code-panel"><div className="panel-heading"><div><h2><Icon name="code" size={16} /> State becomes capability</h2></div><span className="fixture-tag">CONCEPT</span></div><div className="code-file"><span /><span /><span /><code>incident-context.tsx · simplified</code></div><pre aria-label="Illustrative React conditional rendering"><code><span className="syntax-comment">{"// React controls what becomes available"}</span>{"\n"}<span className="syntax-brace">{"{"}</span><span className={incident.operatorVerified ? "syntax-green" : "syntax-orange"}>verified</span>{" && incidentActive && (\n  "}<span className="syntax-purple">{"<RollbackTool />"}</span>{"\n)"}<span className="syntax-brace">{"}"}</span></code></pre><div className="code-status"><span className={`status-dot ${rollback.availability === "available" ? "green" : "gray"}`} /><span>{rollback.availability === "unknown" ? "Current agent state unavailable" : rollback.availability === "locked" ? "verified = false → recovery unavailable" : recovered ? "incidentActive = false → recovery complete" : "verified = true → recovery available"}</span></div><p className="code-disclaimer">Illustrative code, not a compiled LLM request. Inspect real model inputs in Curb’s native inspector.</p></section>
        <section className="voice-placeholder" aria-label="Future live voice session"><span className="voice-icon"><Icon name="mic" size={20} /></span><div><h2>Voice, when we’re ready.</h2><p>Reserved for the real Curb voice session.</p></div><span className="offline-badge">Not connected</span></section></div>
      </div>
      <footer><span><span className="footer-dot" />{preview ? "All telemetry is synthetic. Preview controls never authorize recovery." : "Real agent events, synthetic incident. Authorization remains in the agent."}</span><span>Launch Night <span className="footer-separator">/</span> Powered by KugelAudio</span></footer>
    </main>
  </div>;
}

function App() {
  const [adapter] = useState(() => new URLSearchParams(window.location.search).get("mode") === "live" ? createLiveAdapter() : createPreviewAdapter());
  return <Dashboard adapter={adapter} previewControls={import.meta.env.DEV && "selectScene" in adapter ? <PreviewControls adapter={adapter} /> : undefined} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
