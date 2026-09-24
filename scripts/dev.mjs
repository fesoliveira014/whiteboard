import { spawn } from "node:child_process";

import { packageManagerCommand } from "../apps/review-desktop/scripts/package-manager.mjs";

const env = { ...process.env, REVIEW_DESKTOP_DEV_FAST: "1" };

if (process.argv.includes("--background"))
  env.DEV_FAST_REVIEW_DESKTOP_BACKGROUND = "1";

for (const task of ["desktop:build", "desktop:run"]) {
  const [file, args] = packageManagerCommand("pnpm", [task]);
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${task} exited with ${code}`)),
    );
  });
}
