import { spawnSync } from "node:child_process";

for (const args of [
  ["--test", "scripts/**/*.test.mjs"],
  ["--import", "tsx", "--test", "code-oss/src/vs/review/**/*.test.ts"],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.test.json" },
  });

  if (result.error) throw result.error;

  if (result.status !== 0) process.exit(result.status ?? 1);
}
