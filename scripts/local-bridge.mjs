import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { isIncidentSnapshot } from "../src/incident/events.ts";

export const LOCAL_BRIDGE_PORT = 4187;
export const DASHBOARD_ORIGIN = "http://127.0.0.1:5173";
const SESSION_ID = /^preview-[0-9a-f-]{36}$/;
const MAX_BODY = 32 * 1024;

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function sse(res, name, value) {
  if (!res.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`)) res.end();
}

function authorized(actual, expected) {
  if (typeof actual !== "string" || !actual.startsWith("Bearer ")) return false;
  const left = Buffer.from(actual.slice(7));
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readBody(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validTransition(previous, next) {
  const events = next.recentEvents.filter((event) => event.sequence > (previous?.sequence ?? 0));
  const types = events.map((event) => event.type);
  const wasVerified = previous?.incident.operatorVerified ?? false;
  const wasRecovered = previous?.incident.incidentStatus === "resolved";
  if (!previous && next.sequence === 0) return !next.incident.operatorVerified && next.incident.incidentStatus === "active";
  if (!wasVerified && next.incident.operatorVerified && !types.includes("operator_verification_succeeded")) return false;
  if (wasVerified && !next.incident.operatorVerified) return false;
  if (wasRecovered && next.incident.incidentStatus !== "resolved") return false;
  if (!wasRecovered && next.incident.incidentStatus === "resolved") {
    const rollback = types.indexOf("rollback_executed");
    if (rollback < 0 || types.indexOf("service_recovered") !== rollback + 1) return false;
  }
  if (!next.incident.operatorVerified && types.some((type) => type === "recovery_capability_unlocked" || type === "rollback_executed" || type === "service_recovered")) return false;
  return true;
}

/** In-memory mirror of authenticated local preview snapshots; no agent commands. */
export function createLocalBridge({ token, dashboardOrigin = DASHBOARD_ORIGIN } = {}) {
  if (typeof token !== "string" || token.length < 32) throw new Error("A private bridge token is required.");
  const sessions = new Map();
  const directoryClients = new Set();
  const sessionClients = new Map();
  const directory = () => [...sessions].map(([sessionId, entry]) => ({
    sessionId, sequence: entry.snapshot.sequence, updatedAt: entry.updatedAt,
    deployment: entry.snapshot.incident.currentDeployment, health: entry.snapshot.incident.serviceHealth,
  })).sort((a, b) => b.updatedAt - a.updatedAt);
  const server = createServer(async (req, res) => {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${server.address()?.port}`) return json(res, 403, { error: "invalid_host" });
    let url;
    try { url = new URL(req.url ?? "/", `http://${host}`); }
    catch { return json(res, 400, { error: "invalid_url" }); }
    if (url.host !== host) return json(res, 403, { error: "invalid_target" });
    if (req.method === "POST" && url.pathname === "/ingest") {
      if (req.headers.origin || !authorized(req.headers.authorization, token)) return json(res, 403, { error: "forbidden" });
      if (!req.headers["content-type"]?.startsWith("application/json")) return json(res, 415, { error: "json_required" });
      let body;
      try { body = await readBody(req); } catch { return json(res, 400, { error: "invalid_body" }); }
      if (!body || Object.keys(body).sort().join(",") !== "sessionId,snapshot,version" || body.version !== 1 ||
          typeof body.sessionId !== "string" || !SESSION_ID.test(body.sessionId) || !isIncidentSnapshot(body.snapshot)) {
        return json(res, 422, { error: "invalid_snapshot" });
      }
      const previous = sessions.get(body.sessionId)?.snapshot;
      if (previous && previous.streamId !== body.snapshot.streamId) return json(res, 409, { error: "session_identity_changed" });
      if (previous && body.snapshot.sequence < previous.sequence) return json(res, 200, { accepted: false, reason: "stale" });
      if (previous && body.snapshot.sequence === previous.sequence) {
        return JSON.stringify(previous) === JSON.stringify(body.snapshot)
          ? json(res, 200, { accepted: false, reason: "duplicate" })
          : json(res, 409, { error: "conflicting_snapshot" });
      }
      if (!validTransition(previous, body.snapshot)) return json(res, 409, { error: "invalid_transition" });
      if (!previous && sessions.size >= 20) return json(res, 503, { error: "session_limit" });
      const snapshot = structuredClone(body.snapshot);
      sessions.set(body.sessionId, { snapshot, updatedAt: Date.now() });
      const listeners = sessionClients.get(body.sessionId);
      for (const event of snapshot.recentEvents.filter((event) => event.sequence > (previous?.sequence ?? 0))) {
        for (const client of listeners ?? []) sse(client, "incident", event);
      }
      for (const client of directoryClients) sse(client, "sessions", directory());
      return json(res, 202, { accepted: true });
    }
    if (req.method !== "GET" || req.headers.origin !== dashboardOrigin) return json(res, 403, { error: "browser_origin_required" });
    res.setHeader("access-control-allow-origin", dashboardOrigin);
    res.setHeader("vary", "Origin");
    if (url.pathname === "/sessions") return json(res, 200, directory());
    if (url.pathname === "/sessions/events") {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
      directoryClients.add(res);
      sse(res, "sessions", directory());
      req.on("close", () => directoryClients.delete(res));
      return;
    }
    const healthMatch = /^\/sessions\/(preview-[0-9a-f-]{36})\/health$/.exec(url.pathname);
    if (healthMatch) {
      if (url.search || req.headers["content-length"] || req.headers["transfer-encoding"]) return json(res, 400, { error: "probe_accepts_no_input" });
      const entry = sessions.get(healthMatch[1]);
      if (!entry) return json(res, 404, { version: 1, simulated: true, health: "unknown", error: "session_not_found" });
      const { currentDeployment, serviceHealth, errorRatePercent } = entry.snapshot.incident;
      return json(res, serviceHealth === "healthy" ? 200 : 503, {
        version: 1, simulated: true, source: "Launch Night local incident mirror",
        sessionId: healthMatch[1], health: serviceHealth, deployment: currentDeployment,
        errorRatePercent, observedAt: new Date(entry.updatedAt).toISOString(),
      });
    }
    const match = /^\/sessions\/(preview-[0-9a-f-]{36})(?:\/events)?$/.exec(url.pathname);
    if (!match) return json(res, 404, { error: "not_found" });
    const entry = sessions.get(match[1]);
    if (!entry) return json(res, 404, { error: "session_not_found" });
    if (!url.pathname.endsWith("/events")) return json(res, 200, entry.snapshot);
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
    let listeners = sessionClients.get(match[1]);
    if (!listeners) { listeners = new Set(); sessionClients.set(match[1], listeners); }
    listeners.add(res);
    res.write(": connected\n\n");
    req.on("close", () => { listeners.delete(res); if (!listeners.size) sessionClients.delete(match[1]); });
  });
  server.on("close", () => {
    for (const client of directoryClients) client.end();
    for (const listeners of sessionClients.values()) for (const client of listeners) client.end();
  });
  return server;
}
