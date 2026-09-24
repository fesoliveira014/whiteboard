import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import {
  type LaunchDesktopApplicationInput,
  launchDesktopApplication,
} from "./review-app-launcher";
import { diffrExecutable } from "./server/structural-diff";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

class LaunchProcess extends EventEmitter {
  unref = vi.fn<() => void>();
}

it("launches the Windows bundle directly with an isolated profile", async () => {
  const child = new LaunchProcess();

  const spawn = vi.fn<NonNullable<LaunchDesktopApplicationInput["spawn"]>>(
    () => child,
  );

  const executable = "C:\\Users\\A User\\Whiteboard\\Whiteboard.exe";

  const env = {
    ELECTRON_RUN_AS_NODE: "1",
    VSCODE_DEV: "1",
    VSCODE_CLI: "1",
    DEV_FAST_REVIEW_CHECKOUT: "C:\\src\\whiteboard",
    DEV_FAST_REVIEW_DESKTOP_STATE_ROOT: "C:\\Users\\A User\\Review State",
  };

  const attempt = launchDesktopApplication({
    platform: "win32",
    electron: true,
    execPath: executable,
    env,
    spawn,
  });

  expect(spawn).toHaveBeenCalledWith(
    executable,
    [
      "--user-data-dir=C:\\Users\\A User\\Review State\\user-data",
      "--extensions-dir=C:\\Users\\A User\\Review State\\extensions",
    ],
    {
      detached: true,
      env: {
        DEV_FAST_REVIEW_DESKTOP_STATE_ROOT:
          env.DEV_FAST_REVIEW_DESKTOP_STATE_ROOT,
        DEV_FAST_REVIEW_DESKTOP_BACKGROUND: "1",
      },
      stdio: "ignore",
    },
  );
  expect(child.unref).toHaveBeenCalledOnce();
  expect(attempt.successfulExitIsExpected).toBe(false);
  expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
  child.emit("exit", 0, null);
  await expect(attempt.completion).resolves.toEqual({ code: 0, signal: null });
});

it("opens a selected Windows instance instead of the invoking bundle", () => {
  const spawn = vi.fn<NonNullable<LaunchDesktopApplicationInput["spawn"]>>(
    () => new LaunchProcess(),
  );

  const executable = "D:\\Apps\\Whiteboard Preview\\Whiteboard Preview.exe";
  launchDesktopApplication({
    platform: "win32",
    electron: true,
    execPath: "C:\\Apps\\Whiteboard\\Whiteboard.exe",
    instance: { key: "preview", appPath: executable },
    focus: true,
    env: { DEV_FAST_REVIEW_DESKTOP_BACKGROUND: "1" },
    spawn,
  });
  expect(spawn).toHaveBeenCalledWith(executable, [], {
    detached: true,
    env: {},
    stdio: "ignore",
  });
});

it("lets a standalone CLI launch a portable Windows app from its configured path", () => {
  const spawn = vi.fn<NonNullable<LaunchDesktopApplicationInput["spawn"]>>(
    () => new LaunchProcess(),
  );

  const executable = "D:\\Portable Apps\\Whiteboard.exe";
  launchDesktopApplication({
    platform: "win32",
    electron: false,
    env: { DEV_FAST_REVIEW_DESKTOP_COMMAND: executable },
    spawn,
  });
  expect(spawn.mock.calls[0]?.[0]).toBe(executable);
  expect(spawn.mock.calls[0]?.[2].shell).toBeUndefined();
});

it("does not launch the calling channel for a selected Windows channel with no discovery record", () => {
  const spawn = vi.fn<NonNullable<LaunchDesktopApplicationInput["spawn"]>>(
    () => new LaunchProcess(),
  );

  launchDesktopApplication({
    platform: "win32",
    electron: true,
    execPath: "C:\\Apps\\Whiteboard\\Whiteboard.exe",
    instance: { key: "preview" },
    env: {},
    spawn,
  });
  expect(spawn.mock.calls[0]?.[0]).toBe("Whiteboard Preview.exe");
});

it("reports a missing Windows executable", async () => {
  const child = new LaunchProcess();

  const attempt = launchDesktopApplication({
    platform: "win32",
    electron: false,
    env: {},
    spawn: () => child,
  });

  child.emit("error", new Error("spawn Whiteboard.exe ENOENT"));
  await expect(attempt.completion).rejects.toThrow("ENOENT");
});

it("resolves the Windows structural diff binary and preserves explicit overrides", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-windows-diffr-"));
  roots.push(root);
  vi.stubEnv("REVIEW_DIFFR_BINARY", "");
  expect(diffrExecutable(root, "win32")).toBe("diffr.exe");
  await mkdir(path.join(root, "bin"));
  await writeFile(path.join(root, "bin", "diffr"), "Unix binary");
  expect(diffrExecutable(root, "win32")).toBe("diffr.exe");
  const executable = path.join(root, "bin", "diffr.exe");
  await writeFile(executable, "Windows binary");
  expect(diffrExecutable(root, "win32")).toBe(executable);
  vi.stubEnv("REVIEW_DIFFR_BINARY", "D:\\Tools\\diffr.exe");
  expect(diffrExecutable(root, "win32")).toBe("D:\\Tools\\diffr.exe");
});
