/** Cursor's one-click MCP install link for Whiteboard's server. */
export function cursorInstallDeeplink(launch: {
  command: string;
  args: string[];
  env?: Record<string, string>;
}): string {
  const config = Buffer.from(
    JSON.stringify({
      command: launch.command,
      args: launch.args,
      env: launch.env,
    }),
  ).toString("base64");

  return `cursor://anysphere.cursor-deeplink/mcp/install?name=whiteboard&config=${encodeURIComponent(config)}`;
}
