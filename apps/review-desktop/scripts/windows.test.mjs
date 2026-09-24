import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { launchOptions } from "./windows.mjs";

test("development Windows launches use the checkout server and preserve path arguments", () => {
  const stateRoot = path.resolve("test profile with spaces");

  const launch = launchOptions({
    product: { nameShort: "Whiteboard Preview" },
    stateRoot,
    environment: {
      DEV_FAST_REVIEW_SHARED_DATA_DIR: "C:\\data & notes",
      DEV_FAST_REVIEW_DISABLE_GPU: "1",
    },
  });

  assert.equal(path.basename(launch.executable), "Whiteboard Preview.exe");
  assert.ok(
    launch.args.includes(
      `--user-data-dir=${path.join(stateRoot, "user-data")}`,
    ),
  );
  assert.ok(launch.args.includes("--shared-data-dir=C:\\data & notes"));
  assert.ok(launch.args.includes("--disable-gpu"));
  assert.equal(launch.args.at(-1), ".");
  assert.equal(launch.env.VSCODE_DEV, "1");
  assert.ok(
    launch.env.DEV_FAST_REVIEW_SERVER_ENTRY.endsWith(
      path.join("dist", "server", "desktop-host.js"),
    ),
  );
});

test("packaged Windows launches clear inherited checkout runtime overrides", () => {
  const packagedRoot = path.resolve("installed app");

  const launch = launchOptions({
    product: { nameShort: "Whiteboard" },
    packagedRoot,
    stateRoot: path.resolve("profile"),
    environment: {
      NODE_ENV: "development",
      VSCODE_DEV: "1",
      VSCODE_CLI: "1",
      DEV_FAST_REVIEW_TOOLING_ROOT: "old checkout",
      DEV_FAST_REVIEW_SERVER_ENTRY: "old host",
    },
  });

  assert.equal(launch.executable, path.join(packagedRoot, "Whiteboard.exe"));
  assert.ok(!launch.args.includes("."));

  for (const key of [
    "NODE_ENV",
    "VSCODE_DEV",
    "VSCODE_CLI",
    "DEV_FAST_REVIEW_TOOLING_ROOT",
    "DEV_FAST_REVIEW_SERVER_ENTRY",
  ])
    assert.equal(launch.env[key], undefined);
});
