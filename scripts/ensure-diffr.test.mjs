import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { WINDOWS_DIFFR_SOURCE, ensureDiffr } from "../packages/review/scripts/ensure-diffr.mjs";

test("builds and verifies the pinned Windows binary, then reuses it until damaged", async () => {
  const into = await mkdtemp(path.join(os.tmpdir(), "diffr-windows-"));
  const commands = [];

  const run = async (command, args) => {
    commands.push([command, args]);

    if (command !== "cargo") {
      assert.equal(await readFile(command, "utf8"), "native diffr fixture");
      assert.deepEqual(args, ["--version"]);

      return;
    }

    assert.equal(
      args[args.indexOf("--rev") + 1],
      WINDOWS_DIFFR_SOURCE.revision,
    );
    assert.ok(args.includes("--locked"));
    const root = args[args.indexOf("--root") + 1];
    await mkdir(path.join(root, "bin"));
    await writeFile(path.join(root, "bin/diffr.exe"), "native diffr fixture");
  };

  try {
    await ensureDiffr(["--into", into, "--required"], {
      platform: "win32",
      arch: "x64",
      run,
    });
    assert.equal(
      await readFile(path.join(into, "diffr.exe"), "utf8"),
      "native diffr fixture",
    );
    await ensureDiffr(["--into", into, "--check"], {
      platform: "win32",
      arch: "x64",
      run,
    });
    assert.equal(commands.length, 2);
    await writeFile(path.join(into, "diffr.exe"), "damaged");
    await assert.rejects(
      ensureDiffr(["--into", into, "--check"], {
        platform: "win32",
        arch: "x64",
        run,
      }),
      /missing or not the pinned/,
    );
    assert.equal(commands.length, 2);
  } finally {
    await rm(into, { recursive: true, force: true });
  }
});

test("Windows check never downloads or compiles a missing binary", async () => {
  const into = await mkdtemp(path.join(os.tmpdir(), "diffr-check-"));

  try {
    await assert.rejects(
      ensureDiffr(["--into", into, "--check"], {
        platform: "win32",
        arch: "x64",
        run: async () => assert.fail("check must not run a build"),
      }),
      /missing or not the pinned/,
    );
  } finally {
    await rm(into, { recursive: true, force: true });
  }
});

test("Unix keeps the upstream binary fetcher and its arguments", async () => {
  const args = ["--into", "a path with spaces", "--check", "--required"];
  await ensureDiffr(args, {
    platform: "linux",
    run: async (command, actual) => {
      assert.equal(command, process.execPath);
      assert.equal(path.basename(actual[0]), "fetch.mjs");
      assert.deepEqual(actual.slice(1), args);
    },
  });
});
