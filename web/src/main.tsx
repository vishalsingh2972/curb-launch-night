import { StrictMode, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { ActivityKind, DashboardAdapter, DashboardSnapshot, PreviewAdapter, PreviewScene } from "./adapter.ts";
import { createPreviewAdapter } from "./preview.ts";
import { createLiveAdapter } from "./live.ts";
import { connectLocalMirror, watchLocalSessions, type LocalSession } from "./local-mirror.ts";
import { AgentXRay } from "./xray.ts";
import { HealthProbePanel } from "./health-probe-panel.tsx";
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
  if (!preview) {
    const observations = errorSamples.slice(-4);
    const y = (rate: number) => 154 - rate / 50 * 132;
    const elapsed = (minute: number) => {
      const seconds = Math.floor(minute * 60);
      return `+${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    };
    return <svg className={`chart observation-chart ${recovered ? "chart-healthy" : ""}`} viewBox="0 0 752 190" role="img" aria-label={`Synthetic checkout error rate: ${observations.map((sample) => `${sample.rate.toFixed(1)} percent at ${elapsed(sample.minute)}`).join(", ")}. Discrete agent observations, not continuous monitoring.`}>
      {[0, 10, 20, 30, 40, 50].map((rate) => <g key={rate}><line className="grid-line" x1="48" x2="720" y1={y(rate)} y2={y(rate)} /><text x="32" y={y(rate) + 4} textAnchor="end">{rate}%</text></g>)}
      <line className="threshold" x1="48" x2="720" y1={y(5)} y2={y(5)} /><text className="threshold-label" x="716" y={y(5) - 6} textAnchor="end">5% threshold</text>
      {observations.map((sample, index) => {
        const x = 48 + (index + 1) / (observations.length + 1) * 672;
        return <g className={`observation-point ${sample.rate > 5 ? "elevated" : "recovered"}`} key={`${sample.minute}:${index}`}><line className="observation-stem" x1={x} x2={x} y1={y(sample.rate)} y2="154" /><circle className="observation-dot" cx={x} cy={y(sample.rate)} r="6" /><text className="observation-rate" x={x} y={y(sample.rate) - 14} textAnchor="middle">{sample.rate.toFixed(1)}%</text><text className="observation-time" x={x} y="180" textAnchor="middle">{elapsed(sample.minute)}</text></g>;
      })}
    </svg>;
  }
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
  </svg>;
}

const eventIcon: Record<ActivityKind, "pulse" | "terminal" | "shield" | "lock" | "check"> = { incident: "pulse", tool_call: "terminal", operator_verified: "shield", verification_failed: "lock", capability_unlocked: "shield", service_recovered: "check", confirmation_pending: "lock", rollback_completed: "check" };

function PreviewControls({ adapter }: { adapter: PreviewAdapter }) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  return <div className="scene-controls"><span className="scene-caption">Preview scene</span><div className="segmented" role="group" aria-label="Development-only preview scene">{(["initial", "verified", "recovered"] as PreviewScene[]).map((scene, i) => <button key={scene} type="button" aria-pressed={snapshot.revision === scene} onClick={() => adapter.selectScene(scene)}><span>{String(i + 1).padStart(2, "0")}</span>{scene[0].toUpperCase() + scene.slice(1)}</button>)}</div></div>;
}

/** Display-only view: the live adapter can replace fixtures without granting UI commands. */
function Dashboard({ adapter, previewControls, localSessionControls, localSessionId, localMirror = false }: { adapter: DashboardAdapter; previewControls?: ReactNode; localSessionControls?: ReactNode; localSessionId?: string; localMirror?: boolean }) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  const { incident, activity, capabilities } = snapshot;
  const preview = snapshot.source === "preview";
  const feedRef = useRef<HTMLOListElement>(null);
  useEffect(() => { if (!preview && activity.length && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [preview, activity.length]);
  if (!incident) return <div className="app"><header className="topbar"><a className="brand" href="/"><span className="brand-mark"><span /></span><strong>Launch Night.</strong></a><span className="environment">Simulated Environment</span></header><main><section className="panel live-waiting"><div className="eyebrow">{localMirror ? "LOCAL LIVE MIRROR" : "HOSTED LIVE MODE / CONNECTION PREPARED"}</div><h1>Waiting for a Curb session.</h1><p>{snapshot.connectionDetail}</p><p>No agent state has been received. Metrics, verification and recovery availability are unknown.</p><AgentXRay snapshot={snapshot} />{localMirror && <HealthProbePanel sessionId={localSessionId} snapshot={snapshot} />}{localMirror ? <><p>Start a real conversation in the Curb preview at <strong>127.0.0.1:4000</strong>, then select its session below. This dashboard mirrors events; it does not join the voice room.</p>{localSessionControls}</> : <p>A hosted session bootstrap must supply an already-joined LiveKit room to the prepared connector.</p>}<a href="/">Return to offline UI Preview Mode</a></section></main></div>;
  const recovered = incident.incidentStatus === "resolved";
  const available = capabilities.filter((capability) => capability.availability === "available").length;
  return <div className={`app ${recovered ? "is-recovered" : ""} ${preview ? "" : "is-live"}`}>
    <header className="topbar">
      <a className="brand" href="#main" aria-label="Launch Night command center"><span className="brand-mark"><span /></span><strong>Launch Night<span className="brand-period">.</span></strong></a>
      <div className="header-service"><span className={`status-dot ${recovered ? "green" : "amber"}`} /><span>Checkout API</span><span className="header-slash">/</span><span className="header-health">{incident.serviceHealth}</span></div>
      <div className="header-right"><span className="environment"><span className="tiny-square" />Simulated Environment</span><span className="powered">Built with <strong>curb.js</strong></span></div>
    </header>
    <main id="main">
      <div className="page-heading"><div><div className="eyebrow">COMMAND CENTER <span>/</span> LAUNCH NIGHT</div><h1>AI Incident Copilot<span className="title-dot">.</span></h1><p>A clear view of the incident. A deliberate path to recovery.</p></div><div className={`incident-badge ${recovered ? "healthy-badge" : ""}`}><span className={`status-dot ${recovered ? "green" : "amber"}`} />{recovered ? "Incident resolved" : "Active incident"}<span className="badge-divider" />LN-001</div></div>

      <section className="preview-bar" aria-label="Dashboard data source"><div className="preview-copy"><span className="preview-label">{preview ? "UI PREVIEW MODE" : localMirror ? "LOCAL LIVE MIRROR" : "HOSTED LIVE MODE"}</span><span>{preview ? "Deterministic fixtures. No agent connected." : snapshot.connection === "connected" ? localMirror ? "Real Curb preview events · synthetic incident · voice stays in the native preview." : "Agent-reported events. Incident data remains synthetic." : snapshot.connectionDetail}</span></div>{previewControls}{localSessionControls}{preview && <><a className="live-setup-link" href="?mode=local">Local Live Mirror</a><a className="live-setup-link" href="?mode=live">Hosted setup</a></>}</section>

      <div className="metrics" aria-live="polite" aria-atomic="true">
        <section className="metric"><div className="metric-label"><Icon name="pulse" size={16} />Error rate<span className="metric-tag">DEMO / 60s</span></div><div className="metric-bottom"><div key={preview ? undefined : incident.errorRatePercent} className={`metric-number ${recovered ? "text-green" : "text-amber"} ${preview ? "" : "live-observed"}`}>{incident.errorRatePercent.toFixed(1)}<span>%</span></div><span className="metric-note">{recovered ? "Back below threshold" : "Above 5% threshold"}</span></div></section>
        <section className="metric"><div className="metric-label"><Icon name="box" size={16} />Current deployment</div><div className="metric-bottom"><div key={preview ? undefined : incident.currentDeployment} className={`metric-number deployment-number ${preview ? "" : "live-observed"}`}>{incident.currentDeployment}</div><span className="metric-note">Stable: <code>{incident.previousStableDeployment}</code></span></div></section>
        <section className="metric"><div className="metric-label"><Icon name="shield" size={16} />Service health</div><div className="metric-bottom"><div key={preview ? undefined : incident.serviceHealth} className={`health-number ${recovered ? "text-green" : "text-amber"} ${preview ? "" : "live-observed"}`}><span className={`status-dot ${recovered ? "green" : "amber"}`} />{recovered ? "Healthy" : "Degraded"}</div><span className="metric-note">Checkout API</span></div></section>
      </div>

      <div className="dashboard-grid">
        <section className="panel chart-panel"><div className="panel-heading"><div><h2>{preview ? "Error rate over time" : "Error rate observations"}</h2><p>{preview ? "Synthetic checkout requests \u00b7 last 15 minutes" : "Synthetic Checkout API \u00b7 discrete agent observations"}</p></div><span className="legend"><span className={`status-dot ${recovered ? "green" : "amber"}`} />Error rate</span></div><ErrorChart snapshot={snapshot} /><div className="chart-footnote"><Icon name={recovered ? "check" : "arrow"} size={14} /><span>{preview ? recovered ? "Preview recovery: errors returned to 1.1% on v2.4.0." : "Errors began immediately after the v2.4.1 deployment." : "Only actual observations from this session are plotted; no continuous history."}</span><span className="fixture-tag">{preview ? "FIXTURE" : "AGENT DATA"}</span></div></section>

        <section className="panel capability-panel"><div className="panel-heading"><div><h2>Agent capabilities</h2><p>{preview ? "Preview availability; not the model tool list" : "Agent-reported availability; not compiled model input"}</p></div><span className="count-pill">{available} available</span></div><div className="capability-list">{capabilities.map((capability) => <div className={`capability ${capability.name === "execute_rollback" ? `rollback-row ${capability.availability}` : ""}`} key={capability.name}><span className="tool-icon"><Icon name={capability.name === "execute_rollback" ? capability.availability === "locked" ? "lock" : capability.availability === "complete" ? "lock" : "arrow" : "terminal"} size={16} /></span><div className="capability-text"><code>{capability.name}</code><p>{capability.description}</p></div><span className={`availability ${capability.availability}`}>{capability.availability === "available" ? "Available" : capability.availability === "locked" ? "Locked" : capability.availability === "unknown" ? "Unknown" : "Unavailable"}</span></div>)}</div></section>

        <section className="panel activity-panel"><div className="panel-heading"><div><h2>Incident activity</h2><p>A chronological view of the response</p></div><span className="fixture-tag">{preview ? "PREVIEW EVENTS" : "CURB EVENTS"}</span></div><ol ref={feedRef} className="activity-feed" tabIndex={0} aria-live="polite" aria-label={preview ? "Synthetic incident activity, earliest first" : "Agent-reported activity, earliest first"}>{activity.map((event) => <li key={event.id} className={`event event-${event.kind}`}><time>+{event.offset}</time><span className="event-symbol"><Icon name={eventIcon[event.kind]} size={14} /></span><div><h3 className={event.kind === "tool_call" ? "mono" : ""}>{event.title}</h3><p>{event.detail}</p></div></li>)}</ol><div className="activity-bottom"><span className="status-dot gray" />{preview ? "Local fixture stream" : "Curb app messages"}<span>{activity.length} events</span></div></section>

        <div className="explanation-stack"><AgentXRay snapshot={snapshot} />
        {localMirror ? <HealthProbePanel sessionId={localSessionId} snapshot={snapshot} /> : <section className="voice-placeholder" aria-label="Voice session"><span className="voice-icon"><Icon name="mic" size={20} /></span><div><h2>{localMirror ? "Voice in Curb preview" : "Voice, when we’re ready."}</h2><p>{localMirror ? "Speak at 127.0.0.1:4000; this page mirrors tool state." : "Reserved for the real Curb voice session."}</p></div><span className="offline-badge">{localMirror ? "Mirror only" : "Not connected"}</span></section>}</div>
      </div>
      <footer><span><span className="footer-dot" />{preview ? "All telemetry is synthetic. Preview controls never authorize recovery." : "Real agent events, synthetic incident. Authorization remains in the agent."}</span><span>Launch Night <span className="footer-separator">/</span> Powered by KugelAudio</span></footer>
    </main>
  </div>;
}

function LocalMirror() {
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [selected, setSelected] = useState("");
  const [bridgeError, setBridgeError] = useState(false);
  const [adapter, setAdapter] = useState<DashboardAdapter>(() => createLiveAdapter());
  const [adapterSessionId, setAdapterSessionId] = useState("");
  useEffect(() => watchLocalSessions((list) => { setSessions(list); setBridgeError(false); }, () => setBridgeError(true)), []);
  useEffect(() => {
    if (!selected) { setAdapter(createLiveAdapter()); setAdapterSessionId(""); return; }
    const connection = connectLocalMirror(selected);
    setAdapter(connection.adapter);
    setAdapterSessionId(selected);
    return connection.close;
  }, [selected]);
  const controls = <label className="local-session-picker">Curb preview session <select aria-label="Choose the active Curb preview session" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">{bridgeError ? "Bridge unavailable" : sessions.length ? "Choose a session" : "Waiting for sessions"}</option>{sessions.map((session) => <option key={session.sessionId} value={session.sessionId}>{session.sessionId} · {session.deployment} · {session.health}</option>)}</select></label>;
  return <Dashboard adapter={adapter} localMirror localSessionControls={controls} localSessionId={selected === adapterSessionId ? selected : undefined} />;
}

function OfflineOrHosted({ mode }: { mode: string | null }) {
  const [adapter] = useState(() => mode === "live" ? createLiveAdapter() : createPreviewAdapter());
  return <Dashboard adapter={adapter} previewControls={import.meta.env.DEV && "selectScene" in adapter ? <PreviewControls adapter={adapter} /> : undefined} />;
}

function App() {
  const mode = new URLSearchParams(window.location.search).get("mode");
  return mode === "local" ? <LocalMirror /> : <OfflineOrHosted mode={mode} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
