import { spawn } from "node:child_process";
import path from "node:path";

const [action, ...args] = process.argv.slice(2);

if (!["build", "run"].includes(action) || args.length) {
  throw new Error("usage: desktop.mjs <build|run>");
}

if (process.platform === "win32") {
  const windows = await import("./windows.mjs");
  await windows[action]();
} else {
  const child = spawn(
    "bash",
    [path.join(import.meta.dirname, `${action}.sh`)],
    {
      stdio: "inherit",
    },
  );

  child.on("error", (error) => {
    throw error;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
