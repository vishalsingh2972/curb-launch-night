import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const curbBin = join(root, "node_modules", "curb", "bin", "curb.js");
const prewarm = join(root, "scripts", "prewarm-curb-dev.mjs");
const tsxConfig = join(root, ".curb", "tsx.tsconfig.json");
const timeoutMessage = "The agent server did not start within 60s.";
const userArgs = process.argv.slice(2);
const portFlag = userArgs.indexOf("--port");
const previewPort = portFlag >= 0 ? Number(userArgs[portFlag + 1]) : 4000;
const devArgs = portFlag >= 0 ? userArgs : [...userArgs, "--port", "4000"];
let active = null;
let stopping = false;
let stopCode = 0;

for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(signal, () => {
    stopping = true;
    stopCode = code;
    active?.kill("SIGTERM");
  });
}

function run(args, env, { watchTimeout = false, quiet = false, limitMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: true,
    });
    active = child;
    let tail = "";
    let timedOut = false;
    let killTimer;
    const deadline = limitMs > 0 ? setTimeout(() => {
      console.error(`[launch-night] Initialization did not finish within ${limitMs / 1000}s; stopping it.`);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      killTimer.unref();
    }, limitMs) : null;
    deadline?.unref();
    const output = (stream, target) => stream.on("data", (chunk) => {
      if (!quiet) target.write(chunk);
      if (!watchTimeout || timedOut) return;
      tail = (tail + chunk.toString("utf8")).replace(/\u001b\[[0-9;]*m/g, "").slice(-4096);
      if (tail.includes(timeoutMessage)) {
        timedOut = true;
        console.error("\n[launch-night] Curb's 60-second agent startup deadline expired; stopping this preview.");
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
        killTimer.unref();
      }
    });
    output(child.stdout, process.stdout);
    output(child.stderr, process.stderr);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(deadline);
      clearTimeout(killTimer);
      if (active === child) active = null;
      resolve({ code, signal, timedOut });
    });
  });
}

function ensurePortFree(port) {
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      reject(new Error("The preview port must be an integer from 1 to 65535."));
      return;
    }
    const probe = createServer();
    probe.once("error", (error) => reject(new Error(`Preview port ${port} is unavailable: ${error.message}`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

try {
  // Do not silently open 4001 when another preview already owns recording port 4000.
  await ensurePortFree(previewPort);
  // The installed Curb shim creates the version-matched TSX config without changing source.
  const version = await run([curbBin, "--version"], process.env, { quiet: true, limitMs: 30000 });
  if (version.code !== 0 || stopping) throw new Error("Curb CLI initialization failed.");
  const start = Date.now();
  console.log("[launch-night] Prewarming Curb agent initialization; no model or voice call is made.");
  const warm = await run(["--import", import.meta.resolve("tsx"), prewarm], {
    ...process.env,
    TSX_TSCONFIG_PATH: tsxConfig,
    AGENT_PROJECT_DIR: root,
  }, { limitMs: 180000 });
  if (warm.code !== 0 || stopping) throw new Error("Curb agent prewarm failed; dev preview was not started.");
  console.log(`[launch-night] Prewarm completed in ${((Date.now() - start) / 1000).toFixed(1)}s; starting Curb preview.`);

  for (let attempt = 1; attempt <= 2 && !stopping; attempt++) {
    const result = await run([curbBin, "dev", ...devArgs], process.env, { watchTimeout: true });
    if (stopping) break;
    if (result.timedOut && attempt === 1) {
      console.error("[launch-night] Retrying one clean Curb startup after the timed-out child. No files were touched.");
      continue;
    }
    if (result.timedOut) throw new Error("Curb agent startup timed out twice. See the diagnostics above; no preview is running from this launcher.");
    process.exitCode = result.code ?? 1;
    break;
  }
  if (stopping) process.exitCode = stopCode;
} catch (error) {
  console.error("[launch-night]", error);
  process.exitCode = stopping ? stopCode : 1;
}
