import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installReviewCommand,
  pathShimPath,
  removeCliInstall,
  resolveCliInstallStatus,
} from "./cli-install";
import { reviewMcpLaunch } from "./connect-prompts";

const run = promisify(execFile);

const packageRoot = path.resolve(import.meta.dirname, "..");

let homeDir: string;

let cliPath: string;

let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  homeDir = await mkdtemp(
    path.join(os.tmpdir(), "whiteboard 日本語 & %USERNAME% "),
  );
  cliPath = path.join(homeDir, "test cli 日本語 %USERNAME%.cjs");
  env = { DEV_REVIEW_HOME: path.join(homeDir, ".dev 日本語 %TEMP%") };
  await writeFile(
    cliPath,
    `process.stdout.write(JSON.stringify({ args: process.argv.slice(2), home: process.env.DEV_REVIEW_HOME, electron: process.env.ELECTRON_RUN_AS_NODE, stdin: process.env.FIXTURE_STDIN ? require("node:fs").readFileSync(0, "utf8") : undefined })); process.exitCode = Number(process.env.FIXTURE_EXIT_CODE || 0);`,
  );
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

describe("Windows command installation", () => {
  it("installs and removes its native command without changing shell profiles", async () => {
    const profile = path.join(homeDir, ".zprofile");
    await writeFile(profile, "user settings\n");

    const { shimPath } = await installReviewCommand({
      cliPath,
      cliRuntimePath: process.execPath,
      homeDir,
      env,
      platform: "win32",
    });

    expect(path.extname(shimPath)).toBe(".cmd");

    const status = await resolveCliInstallStatus({
      packageRoot,
      homeDir,
      env,
      platform: "win32",
    });

    expect(status.shim.installed).toBe(true);
    expect(status.shim.onPath).toBe(false);

    await removeCliInstall({ shim: true, homeDir, env, platform: "win32" });
    expect(existsSync(shimPath)).toBe(false);
    expect(
      existsSync(path.join(path.dirname(shimPath), "whiteboard-launcher.ps1")),
    ).toBe(false);
    expect(await readFile(profile, "utf8")).toBe("user settings\n");
    expect(existsSync(path.join(homeDir, ".bash_profile"))).toBe(false);
  });

  it("preserves an existing user command on install and removal", async () => {
    const shimPath = pathShimPath(homeDir, "win32");
    await mkdir(path.dirname(shimPath), { recursive: true });
    const command = "@echo user command\r\n";
    await writeFile(shimPath, command);

    await installReviewCommand({ cliPath, homeDir, env, platform: "win32" });
    await removeCliInstall({ shim: true, homeDir, env, platform: "win32" });
    expect(await readFile(shimPath, "utf8")).toBe(command);
  });

  it("preserves an unmanaged launcher on install and removal", async () => {
    const shimPath = pathShimPath(homeDir, "win32");

    const helperPath = path.join(
      path.dirname(shimPath),
      "whiteboard-launcher.ps1",
    );

    await mkdir(path.dirname(shimPath), { recursive: true });
    await writeFile(helperPath, "user script");
    await expect(
      installReviewCommand({ cliPath, homeDir, env, platform: "win32" }),
    ).rejects.toThrow("Refusing to replace");
    expect(existsSync(shimPath)).toBe(false);
    await writeFile(shimPath, "rem Managed by Whiteboard Desktop\r\n");
    await removeCliInstall({ shim: true, homeDir, env, platform: "win32" });
    expect(existsSync(shimPath)).toBe(false);
    expect(await readFile(helperPath, "utf8")).toBe("user script");
  });

  it("recognizes case-insensitive Windows Path entries", async () => {
    const directory = path.dirname(pathShimPath(homeDir, "win32"));
    env.Path = `C:\\Windows;"${directory.toUpperCase()}"`;

    const installed = await installReviewCommand({
      cliPath,
      homeDir,
      env,
      platform: "win32",
    });

    const status = await resolveCliInstallStatus({
      packageRoot,
      homeDir,
      env,
      platform: "win32",
    });

    expect(status.shim.onPath).toBe(true);
    expect(installed.output).not.toContain("edit Path");
  });

  it("reports a Windows command that shadows the installed shim", async () => {
    const otherBin = path.join(homeDir, "other bin");
    await mkdir(otherBin);
    const otherCommand = path.join(otherBin, "whiteboard.CMD");
    await writeFile(otherCommand, "@echo other\r\n");
    env.Path = `${otherBin};${path.dirname(pathShimPath(homeDir, "win32"))}`;
    env.PATHEXT = ".EXE;.CMD";

    const installed = await installReviewCommand({
      cliPath,
      homeDir,
      env,
      platform: "win32",
    });

    expect(installed.output).toContain(otherCommand);
  });
});

describe.skipIf(process.platform !== "win32")(
  "native Windows shim execution",
  () => {
    it("starts the MCP command through the same argument list used by agent clients", async () => {
      await installReviewCommand({
        cliPath,
        cliRuntimePath: process.execPath,
        homeDir,
        env,
      });

      const launch = reviewMcpLaunch(true, "win32", {
        cliPath,
        cliRuntimePath: process.execPath,
        devHome: env.DEV_REVIEW_HOME,
      });

      const withoutPath = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key.toUpperCase() !== "PATH",
        ),
      );

      const result = await run(launch.command, launch.args, {
        env: { ...withoutPath, ...env, ...launch.env, PATH: "" },
      });

      expect(JSON.parse(result.stdout)).toEqual({
        args: ["mcp"],
        home: env.DEV_REVIEW_HOME,
        electron: "1",
      });
    });

    it("forwards quoted arguments and exit status using the bundled runtime", async () => {
      const { shimPath } = await installReviewCommand({
        cliPath,
        cliRuntimePath: process.execPath,
        homeDir,
        env,
      });

      const launchEnv = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key.toUpperCase() !== "PATH",
        ),
      );

      launchEnv.PATH = path.dirname(shimPath);

      const execution = run(
        "cmd.exe",
        [
          "/d",
          "/s",
          "/c",
          String.raw`"whiteboard "argument with spaces" "a&b" "{\"key\":\"value with space\"}" "" "trailing\\""`,
        ],
        {
          env: { ...launchEnv, ...env, FIXTURE_STDIN: "1" },
          windowsVerbatimArguments: true,
          windowsHide: true,
        },
      );

      execution.child.stdin?.end("stdin payload");

      const result = await execution;
      expect(JSON.parse(result.stdout).stdin).toBe("stdin payload");
      expect(JSON.parse(result.stdout).args).toEqual([
        "argument with spaces",
        "a&b",
        '{"key":"value with space"}',
        "",
        "trailing\\",
      ]);
      await expect(
        run("cmd.exe", ["/d", "/c", "whiteboard"], {
          env: { ...launchEnv, ...env, FIXTURE_EXIT_CODE: "7" },
        }),
      ).rejects.toMatchObject({ code: 7 });
    });
  },
);
