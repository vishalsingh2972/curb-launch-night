import type { connectAgent, ConnectAgentOptions } from "curb/client";
import { createLiveAdapter } from "./live.ts";

/** Prepared integration seam. The caller owns room join, consent, credentials and audio.
 * Nothing calls this automatically; localhost:4000 is not a room or a public session API. */
export async function connectLiveDashboard(room: Parameters<typeof connectAgent>[0], options: ConnectAgentOptions = {}) {
  if (room.state !== "connected") throw new Error("Join the authorized Curb LiveKit room before connecting dashboard telemetry.");
  const { connectAgent } = await import("curb/client");
  const client = connectAgent(room, options);
  const adapter = createLiveAdapter(client);
  const close = () => { adapter.close(); client.close(); room.off("disconnected", close); };
  room.on("disconnected", close);
  await adapter.ready;
  return { adapter, close }; // Telemetry cleanup only; does not end the caller-owned call.
}
