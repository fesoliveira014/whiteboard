import os from "node:os";
import path from "node:path";

/** Registers dev.fast Whiteboard's MCP server. Requires Whiteboard Desktop with the whiteboard command installed. */
export default async function whiteboardPlugin() {
  const windows = process.platform === "win32";

  const executable = path.join(
    os.homedir(),
    ".local",
    "bin",
    windows ? "whiteboard-launcher.ps1" : "whiteboard",
  );

  return {
    config: async (config) => {
      config.mcp = {
        ...config.mcp,
        whiteboard: {
          type: "local",
          command: windows
            ? [
                "powershell.exe",
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                executable,
                "mcp",
              ]
            : ["sh", "-c", 'exec "$HOME/.local/bin/whiteboard" mcp'],
          enabled: true,
        },
      };
    },
  };
}
