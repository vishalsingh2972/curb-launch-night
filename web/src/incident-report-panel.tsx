import type { DashboardSnapshot } from "./adapter.ts";
import { createIncidentReport } from "./incident-report.ts";

export function IncidentReportPanel({ sessionId, snapshot }: { sessionId?: string; snapshot: DashboardSnapshot }) {
  const report = createIncidentReport(sessionId, snapshot);
  const detail = report ? `Completed from ${report.eventCount} observed backend events.` :
    !sessionId || snapshot.connection !== "connected" ? "Select a connected Curb preview session." :
    snapshot.incident?.incidentStatus === "resolved" ? "Required recovery events were not observed." :
    "Available after an observed successful recovery.";
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report.markdown], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `launch-night-incident-${report.sessionId.slice(-8)}.md`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className={`incident-report-panel ${report ? "ready" : ""}`} aria-label="Incident Report">
    <div><h3>{report ? "Recovery documented" : "Incident Report"}</h3><p>{detail} Synthetic incident data only.</p></div>
    <button type="button" disabled={!report} onClick={download}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" /></svg>Download Markdown</button>
  </section>;
}
