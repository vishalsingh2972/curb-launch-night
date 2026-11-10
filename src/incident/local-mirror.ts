import { readFile } from "node:fs/promises";
import type { IncidentSnapshot } from "./events.js";

const tokenFile = new URL("../../.curb/.env.local-bridge-token", import.meta.url);
const ingestUrl = "http://127.0.0.1:4187/ingest";

/** Optional local preview telemetry. No token exists in hosted calls or ordinary tests. */
export async function publishLocalSnapshot(sessionId: string | undefined, snapshot: IncidentSnapshot): Promise<void> {
  if (!sessionId?.startsWith("preview-")) return;
  let token: string;
  try {
    token = (await readFile(tokenFile, "utf8")).trim();
  } catch {
    return; // Local mirror is not running.
  }
  if (!token) return;
  try {
    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: 1, sessionId, snapshot }),
      signal: AbortSignal.timeout(350),
    });
    if (!response.ok) console.warn(`[launch-night] Local mirror rejected snapshot (${response.status}); agent tool succeeded independently.`);
  } catch {
    console.warn("[launch-night] Local mirror unavailable; agent tool succeeded independently.");
  }
}
