import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  hasRenderer,
  packagedBinary,
  reviewLaunch,
  terminateLaunch,
} from "./smoke-launch-packaged.mjs";

test("packaged smoke reads each platform's product metadata and launches its executable", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "whiteboard smoke product "),
  );

  try {
    for (const platform of ["darwin", "linux", "win32"]) {
      const app = path.join(root, platform);

      const resources = path.join(
        app,
        platform === "darwin" ? "Contents/Resources/app" : "resources/app",
      );

      await mkdir(resources, { recursive: true });
      await writeFile(
        path.join(resources, "product.json"),
        JSON.stringify({
          nameShort: "Whiteboard Preview",
          applicationName: "review-preview",
        }),
      );

      const expected =
        platform === "darwin"
          ? path.join(app, "Contents/MacOS/Whiteboard Preview")
          : path.join(
              app,
              platform === "win32"
                ? "Whiteboard Preview.exe"
                : "review-preview",
            );

      assert.equal(await packagedBinary(app, platform), expected);

      const launch = await reviewLaunch({
        app,
        stateRoot: root,
        debugPort: 9222,
        platform,
      });

      assert.equal(launch.command, expected);
      assert.ok(
        launch.args.includes(`--user-data-dir=${path.join(root, "user-data")}`),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows renderer discovery requires this launch's parent PID and profile", () => {
  const profile = "C:\\Users\\Someone\\Smoke & profile";
  let records = [];

  const exec = (command, args, options) => {
    assert.equal(command, "powershell.exe");
    assert.equal(options.env.WHITEBOARD_SMOKE_PARENT_PID, "1234");
    assert.ok(!args.join(" ").includes(profile));

    return JSON.stringify(records);
  };

  const input = { pid: 1234, platform: "win32", exec };
  assert.equal(hasRenderer(profile, input), false);
  records = [
    {
      ParentProcessId: 9999,
      CommandLine: `Whiteboard.exe --type=renderer --user-data-dir="${profile}"`,
    },
    {
      ParentProcessId: 1234,
      CommandLine:
        "Whiteboard.exe --type=renderer --user-data-dir=C:\\another-profile",
    },
    {
      ParentProcessId: 1234,
      CommandLine: `Whiteboard.exe --type=gpu-process --user-data-dir="${profile}"`,
    },
  ];
  assert.equal(hasRenderer(profile, input), false);
  records.push({
    ParentProcessId: 1234,
    CommandLine: `Whiteboard.exe --type=renderer --user-data-dir="${profile.toUpperCase()}"`,
  });
  assert.equal(hasRenderer(profile, input), true);
  records = records.at(-1);
  assert.equal(hasRenderer(profile, input), true);
  assert.equal(hasRenderer(profile, { ...input, pid: undefined }), false);
});

test("Windows cleanup terminates the launch's process tree", () => {
  const calls = [];

  const child = {
    pid: 1234,
    exitCode: null,
    signalCode: null,
    kill: () => assert.fail("taskkill owns Windows tree cleanup"),
  };

  terminateLaunch(child, {
    platform: "win32",
    exec: (command, args) => calls.push([command, args]),
  });
  assert.deepEqual(calls, [["taskkill.exe", ["/PID", "1234", "/T", "/F"]]]);
});

test("the smoke CLI runs from a path containing spaces", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "whiteboard smoke entry "));

  try {
    for (const name of [
      "smoke-launch-packaged.mjs",
      "review-network-policy.mjs",
    ]) {
      await copyFile(
        path.join(import.meta.dirname, name),
        path.join(root, name),
      );
    }

    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "smoke-launch-packaged.mjs"),
        "--app",
        path.join(root, "missing-app"),
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /product\.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "Windows CIM finds a native renderer child and taskkill stops it",
  { skip: process.platform !== "win32" },
  async () => {
    const profile = path.join(
      os.tmpdir(),
      `whiteboard rénderer ${process.pid}`,
    );

    const child = spawn(
      process.execPath,
      [
        "-e",
        "setInterval(() => {}, 1000)",
        "--",
        "--type=renderer",
        `--user-data-dir=${profile}`,
      ],
      { stdio: "ignore" },
    );

    const closed = once(child, "close");

    try {
      await once(child, "spawn");
      assert.equal(hasRenderer(profile, { pid: process.pid }), true);
      assert.equal(
        hasRenderer(`${profile}-other`, { pid: process.pid }),
        false,
      );
    } finally {
      terminateLaunch(child);
      await closed;
    }

    assert.equal(hasRenderer(profile, { pid: process.pid }), false);
  },
);
