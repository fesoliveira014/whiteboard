import path from "node:path";

import { cursorInstallDeeplink } from "./cursor-deeplink";
import type { InstallTarget } from "./install";
import { findReviewPackageRoot } from "./package-paths";

/** POSIX launch form shared with the published agent plugins. */
export const REVIEW_MCP_LAUNCH = {
  command: "sh",
  args: ["-c", 'exec "$HOME/.local/bin/whiteboard" mcp'],
} as const;

export interface ConnectPromptInput {
  /** False when the serving package has no built CLI (Desktop from source): prompts fall back to a bare `whiteboard`. */
  hasShim: boolean;
  legacyPaths: string[];
  traceEnabled: boolean;
  fffBinaryPath: string;
  fffCorpusRoot: string;
  platform?: NodeJS.Platform;
  homeDir?: string;
  cliPath?: string;
  cliRuntimePath?: string;
  devHome?: string;
}

export const FFF_INSTALL_URL =
  "https://raw.githubusercontent.com/dmtrKovalenko/fff/v0.11.0/install-mcp.sh";

export const PI_FFF_PACKAGE = "npm:@ff-labs/pi-fff";

export interface ReviewMcpLaunch {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function reviewMcpLaunch(
  hasShim: boolean,
  platform: NodeJS.Platform = process.platform,
  runtime: { cliPath?: string; cliRuntimePath?: string; devHome?: string } = {},
): ReviewMcpLaunch {
  if (platform === "win32") {
    const env: NonNullable<ReviewMcpLaunch["env"]> = {
      ELECTRON_RUN_AS_NODE: "1",
    };

    if (runtime.devHome) env.DEV_REVIEW_HOME = runtime.devHome;

    return {
      command: runtime.cliRuntimePath ?? process.execPath,
      args: [
        runtime.cliPath ?? path.join(findReviewPackageRoot(), "dist", "cli.js"),
        "mcp",
      ],
      env,
    };
  }

  return hasShim
    ? { command: REVIEW_MCP_LAUNCH.command, args: [...REVIEW_MCP_LAUNCH.args] }
    : { command: "whiteboard", args: ["mcp"] };
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

function numbered(steps: string[]): string[] {
  return steps.map((step, index) => `${index + 1}. ${step}`);
}

function fffSteps(input: ConnectPromptInput, target: InstallTarget): string[] {
  if (!input.traceEnabled) return [];

  // The optional fff installer is a POSIX shell script.
  if ((input.platform ?? process.platform) === "win32") return [];

  if (target === "pi") return [`Run: pi install ${PI_FFF_PACKAGE}`];

  const binary = shellQuote(input.fffBinaryPath);
  const root = shellQuote(input.fffCorpusRoot);
  const add = target === "claude" ? "claude mcp add -s user" : "codex mcp add";

  return [
    `Unless \`${target} mcp get fff\` finds an existing server, run:\n\n\`\`\`sh\n[ -x ${binary} ] || curl -fsSL ${FFF_INSTALL_URL} | bash\n${add} fff -- ${binary} ${root}\n\`\`\``,
  ];
}

function pluginSteps(target: Exclude<InstallTarget, "cursor">): string[] {
  switch (target) {
    case "claude":
      return [
        "Run:\n\n```sh\nclaude plugin marketplace add devdotfast/whiteboard\nclaude plugin install whiteboard@devfast --scope user\nclaude mcp remove -s user whiteboard # old manual registration, if any\n```",
      ];
    case "codex":
      return [
        "Run:\n\n```sh\ncodex plugin marketplace add devdotfast/whiteboard\ncodex plugin add whiteboard@devfast\ncodex mcp remove whiteboard # old manual registration, if any\n```",
      ];
    case "opencode":
      return [
        "Run:\n\n```sh\nopencode plugin @dev.fast/opencode-whiteboard --global\n```",
      ];
    case "pi":
      return ["Run:\n\n```sh\npi install npm:@dev.fast/pi-whiteboard\n```"];
  }
}

function cursorSteps(input: ConnectPromptInput): string[] {
  const launch = reviewMcpLaunch(true, input.platform, input);
  const deeplink = cursorInstallDeeplink(launch);
  const entry = JSON.stringify({ whiteboard: launch }, null, 2);

  return [
    `Do not paste the install link in chat. Chat clients do not open cursor:// links. Open Cursor's MCP install deeplink with the OS URL handler using the command for this operating system, then stop and let me confirm the install:\n\nmacOS: open ${shellQuote(deeplink)}\nLinux: xdg-open ${shellQuote(deeplink)}\nWindows: cmd /c start "" "${deeplink}"`,
    `After I confirm, check for a whiteboard server in ~/.cursor/mcp.json. If the deeplink did not add it, merge this entry into the file's mcpServers object without removing other servers or settings (create the file and object if missing). Do not use this fallback if I declined the install:\n\n\`\`\`json\n${entry}\n\`\`\``,
  ];
}

/** The published Claude/Codex plugin metadata launches sh, so register MCP directly on Windows. */
function windowsSteps(
  target: Exclude<InstallTarget, "cursor">,
  input: ConnectPromptInput,
): string[] {
  const launch = reviewMcpLaunch(true, "win32", input);

  if (target === "pi")
    return [
      "Run:\n\n```powershell\npi install npm:@dev.fast/pi-whiteboard\n```",
    ];

  if (target === "opencode") {
    const entry = JSON.stringify(
      {
        whiteboard: {
          type: "local",
          command: [launch.command, ...launch.args],
          environment: launch.env,
          enabled: true,
        },
      },
      null,
      2,
    );

    return [
      `Merge this entry into the mcp object in ~/.config/opencode/opencode.json, preserving existing settings:\n\n\`\`\`json\n${entry}\n\`\`\``,
    ];
  }

  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";

  const environment = Object.entries(launch.env ?? {})
    .map(([key, value]) => `--env ${quote(`${key}=${value}`)}`)
    .join(" ");

  const command = [launch.command, ...launch.args].map(quote).join(" ");
  const add = target === "claude" ? "claude mcp add -s user" : "codex mcp add";

  return [
    `Register the Whiteboard server from PowerShell (replace an existing manual whiteboard registration if necessary):\n\n\`\`\`powershell\n${add} ${environment} whiteboard -- ${command}\n\`\`\``,
  ];
}

export function connectPrompt(
  target: InstallTarget,
  input: ConnectPromptInput,
): string {
  const platform = input.platform ?? process.platform;

  if (!input.hasShim) {
    const shim =
      platform === "win32"
        ? "%USERPROFILE%\\.local\\bin\\whiteboard.cmd"
        : "~/.local/bin/whiteboard";

    return `Connect this agent to dev.fast Whiteboard.\n\nStop and ask me to install the whiteboard command in Whiteboard Desktop (Settings → Command line), then run this connect command again. The connection requires ${shim}.`;
  }

  const extra =
    target === "claude" || target === "codex" || target === "pi"
      ? fffSteps(input, target)
      : [];

  const verify =
    target === "pi"
      ? `Ask me to run /reload in Pi, then run \`whiteboard api session_get_instructions '{}'\` and confirm it answered. Do not author anything yet.`
      : target === "opencode"
        ? "Stop and tell me to quit and reopen OpenCode: it loads plugins and MCP servers only at startup. After I reopen it, call `session_get_instructions` on the Whiteboard server to confirm the connection. Do not author anything yet."
        : "Reload your MCP tools and call `session_get_instructions` on the Whiteboard server. If a restart is needed, tell me and verify after it. Do not author anything yet.";

  return [
    "Connect this agent to dev.fast Whiteboard.",
    "",
    ...numbered([
      ...(input.legacyPaths.length
        ? [
            `Delete these old Whiteboard skill folders and plugin files:\n${input.legacyPaths.map((item) => `- ${JSON.stringify(item)}`).join("\n")}`,
          ]
        : []),
      ...(target === "cursor"
        ? cursorSteps(input)
        : [
            ...(platform === "win32"
              ? windowsSteps(target, input)
              : pluginSteps(target)),
            ...extra,
          ]),
      verify,
    ]),
  ].join("\n");
}

export function connectSetupPrompt(target: InstallTarget): string {
  return `Run \`whiteboard connect ${target}\` and follow the instructions to connect this agent to Whiteboard.`;
}

export function connectSetupPrompts(): Record<InstallTarget, string> {
  return {
    claude: connectSetupPrompt("claude"),
    codex: connectSetupPrompt("codex"),
    cursor: connectSetupPrompt("cursor"),
    opencode: connectSetupPrompt("opencode"),
    pi: connectSetupPrompt("pi"),
  };
}

export function connectPrompts(
  input: ConnectPromptInput,
): Record<InstallTarget, string> {
  return {
    claude: connectPrompt("claude", input),
    codex: connectPrompt("codex", input),
    cursor: connectPrompt("cursor", input),
    opencode: connectPrompt("opencode", input),
    pi: connectPrompt("pi", input),
  };
}
