import { describe, expect, it } from "vitest";

import { connectPrompt, reviewMcpLaunch } from "./connect-prompts";

const input = {
  hasShim: true,
  legacyPaths: [],
  traceEnabled: true,
  fffBinaryPath: "C:\\Users\\Windows User\\.local\\bin\\fff-mcp",
  fffCorpusRoot: "C:\\Users\\Windows User\\.dev\\trace-search",
  homeDir: "C:\\Users\\Windows User",
  cliPath: "C:\\Users\\A&B\\%USERNAME%\\日本語\\cli.js",
  cliRuntimePath: "C:\\Programs\\Whiteboard.exe",
  devHome: "C:\\Users\\A&B\\.dev",
  platform: "win32" as const,
};

describe("Windows agent connection", () => {
  it("puts the native launcher in Cursor's encoded installation config", () => {
    const prompt = connectPrompt("cursor", input);
    const link = prompt.match(/cursor:\/\/[^\s'"]+/)?.[0];
    expect(link).toBeDefined();
    const url = new URL(link!);

    const config = JSON.parse(
      Buffer.from(url.searchParams.get("config")!, "base64").toString("utf8"),
    );

    expect(config).toEqual(reviewMcpLaunch(true, "win32", input));
    expect(config.command).toBe(input.cliRuntimePath);
    expect(config.env).toEqual({
      ELECTRON_RUN_AS_NODE: "1",
      DEV_REVIEW_HOME: input.devHome,
    });
    expect(config.args).toContain(input.cliPath);
  });

  it.each(["claude", "codex"] as const)(
    "registers %s without installing the POSIX plugin",
    (target) => {
      const prompt = connectPrompt(target, input);
      expect(prompt).toContain(`${target} mcp add`);
      expect(prompt).toContain(input.cliPath);
      expect(prompt).toContain("ELECTRON_RUN_AS_NODE=1");
      expect(prompt).not.toContain("plugin marketplace");
      expect(prompt).not.toContain("| bash");
    },
  );

  it("provides a native OpenCode MCP config", () => {
    const prompt = connectPrompt("opencode", input);
    const config = JSON.parse(prompt.match(/```json\n([\s\S]*?)\n```/)![1]!);
    const launch = reviewMcpLaunch(true, "win32", input);
    expect(config.whiteboard.command).toEqual([launch.command, ...launch.args]);
    expect(config.whiteboard.enabled).toBe(true);
    expect(config.whiteboard.environment).toEqual(launch.env);
  });
});
