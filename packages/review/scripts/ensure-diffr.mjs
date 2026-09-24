import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Upstream 0.1.3 publishes macOS/Linux binaries, but its source supports Windows.
// Pin the source too: changing the npm wire contract requires a matching binary.
export const WINDOWS_DIFFR_SOURCE = Object.freeze({
  version: "0.1.3",
  repository: "https://github.com/devdotfast/diffr.git",
  revision: "ea5f6c126982cef5d7b8059bf05978f07b87b399",
});

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal ?? code}).`));
    });
  });
}

export async function ensureDiffr(
  argv,
  { platform = process.platform, arch = process.arch, run = runCommand } = {},
) {
  const require = createRequire(import.meta.url);

  const packageRoot = path.dirname(
    require.resolve("@dev.fast/diffr/package.json"),
  );

  if (platform !== "win32") {
    await run(process.execPath, [
      path.join(packageRoot, "bin/fetch.mjs"),
      ...argv,
    ]);

    return;
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      into: { type: "string" },
      check: { type: "boolean" },
      required: { type: "boolean" },
    },
  });

  if (!values.into) throw new Error("--into <dir> is required");

  if (arch !== "x64")
    throw new Error(
      `Windows diffr builds currently support x64, received ${arch}.`,
    );

  const { version } = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );

  if (version !== WINDOWS_DIFFR_SOURCE.version)
    throw new Error(
      `Update the pinned Windows diffr source for @dev.fast/diffr ${version}.`,
    );

  const into = path.resolve(values.into);
  const binary = path.join(into, "diffr.exe");
  const stampPath = path.join(into, "diffr.stamp.json");
  const target = "x86_64-pc-windows-msvc";
  const { revision } = WINDOWS_DIFFR_SOURCE;

  try {
    const stamp = JSON.parse(await readFile(stampPath, "utf8"));

    const sha256 = createHash("sha256")
      .update(await readFile(binary))
      .digest("hex");

    if (
      stamp.version === version &&
      stamp.target === target &&
      stamp.revision === revision &&
      stamp.sha256 === sha256
    )
      return;
  } catch {
    // Missing or incomplete builds are rebuilt below.
  }

  if (values.check)
    throw new Error(
      `${binary} is missing or not the pinned diffr ${version} Windows build. Run pnpm --filter @dev.fast/review ensure:diffr.`,
    );

  await mkdir(into, { recursive: true });
  const staging = await mkdtemp(path.join(into, ".diffr-"));

  try {
    console.log(
      `Building diffr ${version} for Windows. Rust (MSVC) and Visual Studio C++ Build Tools are required.`,
    );
    await run("cargo", [
      "install",
      "--locked",
      "--git",
      WINDOWS_DIFFR_SOURCE.repository,
      "--rev",
      revision,
      "--target",
      target,
      "--bin",
      "diffr",
      "--root",
      staging,
      "diffr-cli",
    ]);
    const built = path.join(staging, "bin", "diffr.exe");
    await run(built, ["--version"]);

    const sha256 = createHash("sha256")
      .update(await readFile(built))
      .digest("hex");

    await rename(built, binary);
    await writeFile(
      path.join(staging, "stamp.json"),
      `${JSON.stringify({ version, target, revision, sha256 }, null, 2)}\n`,
    );
    await rename(path.join(staging, "stamp.json"), stampPath);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await ensureDiffr(process.argv.slice(2));
  } catch (error) {
    console.error(`ensure-diffr: ${error.message}`);
    process.exitCode = 1;
  }
}
