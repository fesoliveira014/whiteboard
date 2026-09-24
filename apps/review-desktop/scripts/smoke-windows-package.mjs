import { spawnSync } from "node:child_process";
import path from "node:path";

import { packagedBinary, smokeLaunch } from "./smoke-launch-packaged.mjs";

if (process.argv.length !== 3) {
  throw new Error("usage: smoke-windows-package.mjs <extracted-app>");
}

const app = path.resolve(process.argv[2]);

const binary = await packagedBinary(app);

console.log("Checking the bundled Windows CLI...");

const help = spawnSync(
  binary,
  [path.join(app, "resources/app/review-runtime/dist/cli.js"), "--help"],
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
    timeout: 30_000,
    windowsHide: true,
  },
);

if (help.error) throw help.error;

if (help.status !== 0) {
  throw new Error(`Bundled CLI exited with ${help.signal ?? help.status}`);
}

console.log("Launching the extracted Windows application...");

await smokeLaunch({ app, timeoutMs: 90_000 });
