// Run Curb's own agent initialization once before its fixed 60-second dev-child timer starts.
// This process serves no port and makes no model or voice request.
import { existsSync } from "node:fs";

process.env.AGENT_PROJECT_DIR = process.cwd();
if (existsSync(".env")) process.loadEnvFile(".env");

try {
  const started = performance.now();
  const { createAgentServer } = await import("../node_modules/curb/src/server/main.ts");
  const imported = performance.now();
  const server = await createAgentServer({
    dev: { publicUrl: "http://127.0.0.1:4000", quiet: true, onActivity: () => {} },
  });
  console.log(`[launch-night] Framework import ${((imported - started) / 1000).toFixed(1)}s; agent build ${((performance.now() - imported) / 1000).toFixed(1)}s.`);
  const report = server.report();
  if (report.errors || report.renderError) {
    throw new Error(`Agent prewarm failed: ${report.errors} authoring errors; ${report.renderError ?? "no render error"}.`);
  }
  console.log("[launch-night] Agent initialization prewarm passed.");
  process.exit(0);
} catch (error) {
  console.error("[launch-night] Agent initialization prewarm failed:", error);
  process.exit(1);
}
