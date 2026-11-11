import { StrictMode, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { ActivityKind, DashboardAdapter, DashboardSnapshot, PreviewAdapter, PreviewScene } from "./adapter.ts";
import { createPreviewAdapter } from "./preview.ts";
import { createLiveAdapter } from "./live.ts";
import { adapterForSelectedSession, connectLocalMirror, watchLocalSessions, type LocalSession } from "./local-mirror.ts";
import { AgentXRay } from "./xray.ts";
import { HealthProbePanel } from "./health-probe-panel.tsx";
import { IncidentReportPanel } from "./incident-report-panel.tsx";
import { displayObservations, observationTime, presentationEventIds, presentationMotion, type PresentationMotion } from "./presentation.ts";
import { presentationView, viewUrl, ViewToggle } from "./view.ts";
import "./styles.css";

type IconName = "pulse" | "box" | "shield" | "arrow" | "lock" | "check" | "code" | "mic" | "terminal";
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
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

function ErrorChart({ snapshot, current }: { snapshot: DashboardSnapshot; current: boolean }) {
  const preview = snapshot.source === "preview";
  const observations = current ? displayObservations(snapshot.errorSamples) : [];
  const first = snapshot.errorSamples[0];
  const latest = snapshot.errorSamples.at(-1);
  const recovered = current && snapshot.incident?.incidentStatus === "resolved";
  const y = (rate: number) => 144 - rate / 50 * 110;
  return <section className={`panel chart-panel ${recovered ? "chart-healthy" : ""}`} aria-label="Synthetic error-rate observations">
    <div className="panel-heading"><div><span className="section-kicker">OBSERVABILITY</span><h2>Error rate observations</h2></div><span className="subtle-badge">{preview ? "FIXTURE SAMPLES" : `${snapshot.errorSamples.length} OBSERVED`}</span></div>
    {observations.length ? <svg className="chart" viewBox="0 0 760 184" role="img" aria-label={`${preview ? "Fixture" : "Agent-reported"} discrete synthetic error observations: ${observations.map((sample) => `${sample.rate.toFixed(1)}% at ${observationTime(sample.minute)}`).join(", ")}. No continuous traffic is implied.`}>
      {[0, 20, 40].map((rate) => <g key={rate}><line className="grid-line" x1="42" x2="730" y1={y(rate)} y2={y(rate)} /><text x="30" y={y(rate) + 4} textAnchor="end">{rate}%</text></g>)}
      <line className="threshold" x1="42" x2="730" y1={y(5)} y2={y(5)} />
      <text className="threshold-label" x="728" y={y(5) - 7} textAnchor="end">5% demo threshold</text>
      {observations.map((sample, index) => {
        const x = 65 + (index + .5) / observations.length * 620;
        return <g className={`observation-point ${sample.rate > 5 ? "elevated" : "recovered"}`} key={`${sample.minute}:${sample.rate}`}>
          <rect className="observation-bar" x={x - 25} y={y(sample.rate)} width="50" height={144 - y(sample.rate)} rx="4" />
          <line className="observation-stem" x1={x} x2={x} y1={y(sample.rate)} y2="144" />
          <circle className="observation-dot" cx={x} cy={y(sample.rate)} r="5" />
          <text className="observation-rate" x={x} y={y(sample.rate) - 14} textAnchor="middle">{sample.rate.toFixed(1)}%</text>
          <text className="observation-time" x={x} y="172" textAnchor="middle">{observationTime(sample.minute)}</text>
        </g>;
      })}
    </svg> : <div className="chart-empty"><Icon name="pulse" size={28} /><strong>{current ? "Waiting for a metrics observation" : "No current observations"}</strong><span>{current ? "A real check_metrics call will appear here." : "Select a connected session to see its data."}</span></div>}
    <div className="chart-footnote"><span><span className={`status-dot ${recovered ? "green" : current ? "coral" : "gray"}`} />{preview ? "Synthetic fixture observations" : "Discrete observations · first + latest"}</span>{recovered && first && latest && first.rate > latest.rate ? <strong>{(first.rate - latest.rate).toFixed(1)} pp lower</strong> : <span className="chart-truth">No continuous traffic implied</span>}</div>
  </section>;
}

const eventIcon: Record<ActivityKind, IconName> = { incident: "pulse", tool_call: "terminal", operator_verified: "shield", verification_failed: "lock", capability_unlocked: "shield", service_recovered: "check", confirmation_pending: "lock", rollback_completed: "check" };

function PreviewControls({ adapter }: { adapter: PreviewAdapter }) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  return <div className="scene-controls"><span className="scene-caption">Fixture scene</span><div className="segmented" role="group" aria-label="Development-only preview scene">{(["initial", "verified", "recovered"] as PreviewScene[]).map((scene, i) => <button key={scene} type="button" aria-pressed={snapshot.revision === scene} onClick={() => adapter.selectScene(scene)}><span>0{i + 1}</span>{scene[0].toUpperCase() + scene.slice(1)}</button>)}</div></div>;
}

/** Read-only composition. All domain values come from the selected adapter. */
type ViewProps = { present: boolean; onViewChange: (present: boolean) => void };
function Dashboard({ adapter, previewControls, localSessionControls, localSessionId, localMirror = false, present, onViewChange }: { adapter: DashboardAdapter; previewControls?: ReactNode; localSessionControls?: ReactNode; localSessionId?: string; localMirror?: boolean } & ViewProps) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => { setAdvanced(false); }, [present]);
  const minimal = present && !advanced;
  const layout = minimal ? "present" : "detailed";
  const previousLayout = useRef(layout);
  const previous = useRef(snapshot);
  const [emphasis, setEmphasis] = useState<{ kind: PresentationMotion; ids: readonly string[] }>({ kind: null, ids: [] });
  useEffect(() => {
    previousLayout.current = layout;
    setEmphasis({ kind: null, ids: [] });
  }, [layout]);
  useEffect(() => {
    const before = previous.current;
    const kind = presentationMotion(before, snapshot);
    const ids = presentationEventIds(before, snapshot);
    const stageChanged = before.incident?.incidentStatus !== snapshot.incident?.incidentStatus || before.incident?.operatorVerified !== snapshot.incident?.operatorVerified;
    if (before.source !== snapshot.source || before.sessionId !== snapshot.sessionId || snapshot.connection !== before.connection) {
      setEmphasis({ kind: null, ids: [] });
    } else if (kind || ids.length || stageChanged) {
      setEmphasis((prior) => ({ kind: kind ?? (stageChanged ? null : prior.kind), ids: [...new Set([...prior.ids, ...ids])].slice(-100) }));
    }
    previous.current = snapshot;
  }, [snapshot]);
  const preview = snapshot.source === "preview";
  const current = preview || snapshot.connection === "connected";
  const motion = current && previousLayout.current === layout && previous.current.source === snapshot.source && previous.current.sessionId === snapshot.sessionId ? emphasis.kind : null;
  const incident = current ? snapshot.incident : null;
  const recovered = incident?.incidentStatus === "resolved";
  const verified = incident?.operatorVerified;
  const known = Boolean(incident);
  const { activity, capabilities } = snapshot;
  const feedRef = useRef<HTMLOListElement>(null);
  useEffect(() => { if (!preview && activity.length && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [preview, activity.length]);
  const mode = preview ? "UI Preview Mode" : localMirror ? "Local Live Mirror" : "Hosted Live Mode";
  return <div className={`app ${recovered ? "is-recovered" : known ? "is-degraded" : "is-unknown"} ${preview ? "is-preview" : "is-live"} ${minimal ? "is-present" : ""} ${motion ? `motion-${motion}` : ""}`}>
    <header className="topbar">
      <a className="brand" href="#main" aria-label="Launch Night command center"><span className="brand-mark"><Icon name="pulse" size={22} /></span><strong>Launch Night<span>.</span></strong><span className="brand-slash">/</span><span className="brand-subtitle">Incident Copilot</span></a>
      <div className="header-right"><span className="environment"><span className="tiny-square" />Simulated environment</span><a className="native-preview-link" href="http://127.0.0.1:4000" target="_blank" rel="noreferrer"><Icon name="mic" size={15} />Voice in Curb preview <span aria-hidden="true">↗</span></a><span className="powered">Built with <strong>curb.js</strong></span></div>
    </header>
    <main id="main">
      <div className="view-toolbar"><span>{present ? "Recording view" : "Developer view"}</span><ViewToggle present={present} onChange={onViewChange} />{present && <button type="button" className="advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>{advanced ? "Hide advanced details" : "Show advanced details"}</button>}</div>
      <div className="page-heading"><div><div className="eyebrow">LAUNCH OPERATIONS <span>/</span> AI INCIDENT COPILOT</div><h1>Checkout API <span className={`incident-badge ${recovered ? "healthy-badge" : known ? "degraded-badge" : "unknown-badge"}`}><span className={`status-dot ${recovered ? "green" : known ? "coral" : "gray"}`} />{recovered ? "Recovered" : known ? "Degraded" : "State unknown"}</span></h1></div><div className="heading-context"><span className="section-kicker">{known ? recovered ? "RECOVERY COMPLETE" : verified ? "OPERATOR VERIFIED" : "INVESTIGATION OPEN" : "AWAITING SESSION"}</span><p>{known ? recovered ? "Service restored. Recovery capability removed." : verified ? "Recovery is available. Curb owns confirmation." : "Investigate the regression. Verify before recovery." : "Connect to genuine agent-reported state."}</p></div></div>

      <section className={`source-bar ${preview ? "source-preview" : ""}`} aria-label="Dashboard data source"><div className="source-description"><span className={`source-indicator ${current ? "connected" : ""}`} /><div><strong>{mode}</strong><span>{preview ? "Offline fixtures · no agent connected" : current ? "Selected session events · synthetic checkout data" : localMirror ? snapshot.connection === "disconnected" ? "Disconnected · current state unknown" : "Waiting for a local Curb session" : "Connection prepared · hosted credentials required"}</span></div></div>{previewControls}{localSessionControls}<div className="mode-links">{preview ? <a href={present ? "?mode=local&view=present" : "?mode=local"}>Open Local Live Mirror <span>↗</span></a> : <a href={present ? "/?view=present" : "/"}>Offline preview <span>↗</span></a>}</div></section>
      {present && advanced && localSessionId && <p className="full-session-reference">Selected session <code>{localSessionId}</code></p>}
      {!known && <div className="connection-notice" role="status"><Icon name="terminal" /><p>{localMirror ? "Start a fresh conversation at 127.0.0.1:4000 and select its session above." : "Hosted voice requires an already-joined room from the documented session flow."} <span>{snapshot.connectionDetail} No verification or recovery state is inferred.</span></p></div>}

      <div className="dashboard-grid">
        <section className="incident-overview" aria-label="Current synthetic checkout incident">
          <div className="metrics" aria-live="polite" aria-atomic="true">
            <section className="metric metric-error"><div className="metric-label"><Icon name="pulse" size={16} />Error rate<span>SYNTHETIC</span></div><div className="metric-number">{incident ? incident.errorRatePercent.toFixed(1) : "—"}<span>{incident ? "%" : ""}</span></div><div className="metric-note"><span className={`status-dot ${recovered ? "green" : known ? "coral" : "gray"}`} />{known ? recovered ? "Within demo threshold" : "Above 5% demo threshold" : "Awaiting current snapshot"}</div></section>
            <section className="metric"><div className="metric-label"><Icon name="box" size={16} />Deployment</div><div className="deployment-number">{incident?.currentDeployment ?? "—"}</div><div className="metric-note">Previous stable <code>{incident?.previousStableDeployment ?? "unknown"}</code></div></section>
            <section className="metric"><div className="metric-label"><Icon name="shield" size={16} />Service health</div><div className="health-number">{known ? recovered ? "Healthy" : "Degraded" : "Unknown"}</div><div className="metric-note">{known ? recovered ? "Simulated recovery verified" : "Deployment regression" : "No current health claim"}</div></section>
          </div>
          <ErrorChart snapshot={snapshot} current={current} />
        </section>

        <AgentXRay snapshot={snapshot} motion={motion} />

        <section className="panel activity-panel"><div className="panel-heading"><div><span className="section-kicker">SESSION TIMELINE</span><h2>Incident activity <span className="heading-count">{activity.length}</span></h2></div><span className="subtle-badge">{preview ? "FIXTURE EVENTS" : current ? "BACKEND EVENTS" : "RECORDED HISTORY"}</span></div><ol ref={feedRef} className="activity-feed" tabIndex={0} aria-live="polite" aria-label={preview ? "Synthetic incident activity, earliest first" : "Agent-reported activity, earliest first"}>{activity.length ? activity.map((event) => <li key={event.id} className={`event event-${event.kind} ${emphasis.ids.includes(event.id) ? "event-arriving" : ""}`}><time>+{event.offset}</time><span className="event-symbol"><Icon name={eventIcon[event.kind]} size={16} /></span><div><h3 className={event.kind === "tool_call" ? "mono" : ""}>{event.title}</h3><p>{event.detail}</p></div><span className="event-state">{event.kind === "tool_call" ? "EXECUTED" : event.kind === "capability_unlocked" ? "RENDERED" : "OBSERVED"}</span></li>) : <li className="activity-empty"><Icon name="terminal" size={24} /><strong>No tool executions observed yet.</strong><span>Actual agent actions will appear here in order.</span></li>}</ol><div className="activity-bottom"><span><span className="status-dot gray" />{preview ? "Labeled offline fixtures" : "Agent application events"}</span><span>Relative session time</span></div></section>

        <div className="runtime-bottom">
          <section className="panel capability-panel"><div className="panel-heading"><div><span className="section-kicker">CAPABILITY SURFACE</span><h2>Application tools</h2></div><Icon name="code" size={19} /></div><div className="capability-list">{capabilities.map((capability) => <div className={`capability ${capability.name === "execute_rollback" ? `rollback-row ${capability.availability}` : ""}`} key={capability.name}><span className="tool-icon"><Icon name={capability.name === "execute_rollback" ? capability.availability === "available" ? "arrow" : "lock" : "terminal"} size={15} /></span><div className="capability-text"><code>{capability.name}</code><p>{capability.description}</p></div><span className={`availability ${capability.availability}`}>{capability.availability === "available" ? "Available" : capability.availability === "locked" ? "Locked" : capability.availability === "unknown" ? "Unknown" : "Removed"}</span></div>)}</div><p className="capability-note">{preview ? "Fixture availability." : "Agent-reported availability."} Native Context is the model-input proof.</p></section>
          {localMirror ? <HealthProbePanel sessionId={localSessionId} snapshot={snapshot} /> : <section className="health-probe-panel probe-placeholder"><div className="probe-heading"><div><span className="section-kicker">HTTP OBSERVATION</span><h2>Checkout Health Probe</h2><p>Local simulated health endpoint</p></div></div><div className="probe-placeholder-value">—</div><p>No HTTP request in {preview ? "fixture mode" : "hosted setup"}.</p><a href={present ? "?mode=local&view=present" : "?mode=local"}>Available in Local Live Mirror ↗</a></section>}
        </div>
      </div>
      <div className="recording-closeout">{localMirror ? <IncidentReportPanel sessionId={localSessionId} snapshot={snapshot} /> : present ? <section className="incident-report-panel" aria-label="Incident Report"><div><h3>Incident Report</h3><p>{preview ? "Real-session reports are unavailable in offline fixture mode." : "Requires a connected session and observed recovery."}</p></div><button type="button" disabled>Real session required</button></section> : null}{present && <aside className="camera-safe-area" aria-label="Reserved face-camera space"><span>Face-camera space</span></aside>}</div>
      <footer><span><span className="footer-dot" />{preview ? "All values are offline fixtures. Preview controls never authorize recovery." : "Real session events. Synthetic incident. Authorization stays inside the agent."}</span><span>REACT STATE → AGENT CAPABILITIES <span className="footer-separator">/</span> KugelAudio</span></footer>
    </main>
  </div>;
}

function LocalMirror(view: ViewProps) {
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [selected, setSelected] = useState("");
  const [bridgeError, setBridgeError] = useState(false);
  const [waitingAdapter] = useState<DashboardAdapter>(() => createLiveAdapter());
  const [adapter, setAdapter] = useState<DashboardAdapter>(waitingAdapter);
  const [adapterSessionId, setAdapterSessionId] = useState("");
  useEffect(() => watchLocalSessions((list) => { setSessions(list); setBridgeError(false); }, () => setBridgeError(true)), []);
  useEffect(() => {
    if (!selected) { setAdapter(waitingAdapter); setAdapterSessionId(""); return; }
    const connection = connectLocalMirror(selected);
    setAdapter(connection.adapter);
    setAdapterSessionId(selected);
    return connection.close;
  }, [selected, waitingAdapter]);
  const controls = <label className="local-session-picker"><span>Curb preview session</span><select aria-label="Choose the active Curb preview session" title={selected || "Choose the matching native preview session"} value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">{bridgeError ? "Bridge unavailable" : sessions.length ? "Choose a session" : "Waiting for sessions"}</option>{sessions.map((session) => <option key={session.sessionId} value={session.sessionId}>{view.present ? `Session …${session.sessionId.slice(-12)} · ${session.deployment}` : `${session.sessionId} · ${session.deployment} · ${session.health}`}</option>)}</select></label>;
  return <Dashboard {...view} adapter={adapterForSelectedSession(selected, adapterSessionId, adapter, waitingAdapter)} localMirror localSessionControls={controls} localSessionId={selected === adapterSessionId && selected ? selected : undefined} />;
}

function OfflineOrHosted({ mode, ...view }: { mode: string | null } & ViewProps) {
  const [adapter] = useState(() => mode === "live" ? createLiveAdapter() : createPreviewAdapter());
  return <Dashboard {...view} adapter={adapter} previewControls={import.meta.env.DEV && "selectScene" in adapter ? <PreviewControls adapter={adapter} /> : undefined} />;
}

function App() {
  const mode = new URLSearchParams(window.location.search).get("mode");
  const [present, setPresent] = useState(() => presentationView(window.location.search));
  function onViewChange(value: boolean) {
    window.history.replaceState(window.history.state, "", viewUrl(window.location.href, value));
    setPresent(value);
  }
  return mode === "local" ? <LocalMirror present={present} onViewChange={onViewChange} /> : <OfflineOrHosted mode={mode} present={present} onViewChange={onViewChange} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
