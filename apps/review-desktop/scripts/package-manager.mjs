import { existsSync } from "node:fs";
import path from "node:path";

// Invoke the JS entry point on Windows: npm/pnpm's .cmd shims cannot be
// executed with execFile, and a shell would reinterpret paths and arguments.
export function packageManagerCommand(name, args) {
  if (process.platform !== "win32") return [name, args];

  const active = process.env.npm_execpath;

  const candidates = [
    ...(active && path.basename(active).startsWith(name) ? [active] : []),
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      name,
      "bin",
      `${name}-cli.js`,
    ),
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      name,
      "bin",
      `${name}.cjs`,
    ),
  ];

  const entry = candidates.find(existsSync);

  if (!entry)
    throw new Error(
      `Cannot locate ${name}; run this command through pnpm with Node.js installed.`,
    );

  return [process.execPath, [entry, ...args]];
}
