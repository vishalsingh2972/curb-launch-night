import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createLocalBridge, LOCAL_BRIDGE_PORT } from "./local-bridge.mjs";

const token = randomBytes(32).toString("hex");
const tokenFile = fileURLToPath(new URL("../.curb/.env.local-bridge-token", import.meta.url));
const server = createLocalBridge({ token });
server.listen(LOCAL_BRIDGE_PORT, "127.0.0.1", async () => {
  try {
    await mkdir(fileURLToPath(new URL("../.curb/", import.meta.url)), { recursive: true });
    await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
    console.log(`Local Live Mirror ready at http://127.0.0.1:${LOCAL_BRIDGE_PORT}; token kept in ignored .curb/.`);
  } catch (error) {
    console.error("Could not create the private local bridge token file.", error);
    server.close();
  }
});
server.on("error", (error) => { console.error("Local Live Mirror could not bind 127.0.0.1.", error); process.exitCode = 1; });
