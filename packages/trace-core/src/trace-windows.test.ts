import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describeTraceHookOwners,
  installOpenCodeTraceExtension,
  installPiTraceExtension,
  removeAgentTraceHook,
} from "./agent-trace-hooks";
import { traceScope } from "./trace-command";
import { spawnDetachedTraceSync } from "./trace-hook-runner";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 50,
      }),
    ),
  );
});

async function batchRecorder(prefix: string, captureInput = true) {
  const home = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(home);
  const command = path.join(home, "whiteboard.cmd");
  const log = path.join(home, "calls.json");
  await writeFile(
    path.join(home, "capture.cjs"),
    `
    let input = "";
    function record() {
      require("node:fs").writeFileSync(
        process.env.TRACE_TEST_LOG, JSON.stringify({ args: process.argv.slice(2), input })
      );
    }
    if (${captureInput}) {
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", record);
    } else {
      record();
    }
  `,
  );
  await writeFile(
    command,
    '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"%TRACE_TEST_NODE%" "%~dp0capture.cjs" %*\r\n',
  );
  vi.stubEnv("TRACE_TEST_NODE", process.execPath);
  vi.stubEnv("TRACE_TEST_LOG", log);

  return { home, command, log };
}

describe.skipIf(process.platform !== "win32")("Windows trace launchers", () => {
  for (const install of [
    installPiTraceExtension,
    installOpenCodeTraceExtension,
  ]) {
    it(`runs ${install.name} through a batch path containing spaces and percent signs`, async () => {
      const { home, command, log } = await batchRecorder(
        "trace %PATH% ! spaced ",
      );

      const installed = await install(home, command);
      const sessionId = 'session with & "quotes" and %PATH%';

      const runner = `
        import plugin from ${JSON.stringify(pathToFileURL(installed.path).href)};
        const sessionId = ${JSON.stringify(sessionId)};
        const cwd = ${JSON.stringify(home)};
        if (${JSON.stringify(installed.agent)} === "pi") {
          let start;
          plugin({ on: (event, callback) => { if (event === "session_start") start = callback; } });
          await start({}, { cwd, sessionManager: { getSessionId: () => sessionId } });
        } else {
          const pluginHooks = await plugin({ directory: cwd });
          await pluginHooks.event({ event: { type: "session.created", properties: { info: { id: sessionId } } } });
        }
      `;

      const child = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", runner],
        {
          encoding: "utf8",
          timeout: 10000,
        },
      );

      expect(child.stderr).toBe("");
      expect(child.status).toBe(0);
      const call = JSON.parse(await readFile(log, "utf8"));
      expect(call.args).toEqual(["trace", "hook", "SessionStart"]);
      expect(JSON.parse(call.input)).toEqual({
        hook_event_name: "SessionStart",
        session_id: sessionId,
      });
      expect((await describeTraceHookOwners(home))[installed.agent]).toBe(
        "review",
      );
      expect(await removeAgentTraceHook(installed.agent, home)).toBe(true);
    });
  }

  it("starts detached trace sync from a batch launcher with a spaced path", async () => {
    const { home, command, log } = await batchRecorder(
      "trace sync spaced ",
      false,
    );

    const leadingArgs = ["space here", "a&b", 'say "hello"', "%PATH%"];
    spawnDetachedTraceSync({
      sessionId: "session-12345678",
      cwd: home,
      scope: traceScope({ homeDir: home, env: {} }),
      command: { file: command, args: leadingArgs },
    });
    await vi.waitFor(
      async () => {
        const call = JSON.parse(await readFile(log, "utf8"));
        expect(call.args).toEqual([
          ...leadingArgs,
          "trace",
          "sync",
          "session-12345678",
          "--expect-storage",
          "none",
        ]);
      },
      { timeout: 5000 },
    );
  });
});
