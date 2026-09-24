import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  dependencyDirectoriesExist,
  lockfileDigest,
  needsDependencyInstall,
} from "./code-oss-bootstrap.mjs";
import { packageManagerCommand } from "./package-manager.mjs";

const app = path.resolve(import.meta.dirname, "..");

const root = path.resolve(app, "../..");

const checkout = path.join(app, "code-oss");

const review = path.join(root, "packages/review");

const scripts = import.meta.dirname;

function execute(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: root,
      stdio: "inherit",
      ...options,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`${path.basename(file)} exited with ${signal ?? code}`),
        );
    });
  });
}

const node = (file, args = [], options) =>
  execute(process.execPath, [file, ...args], options);

const manager = (name, args, options) =>
  execute(...packageManagerCommand(name, args), options);

const npm = (...args) => manager("npm", args, { cwd: checkout });

const pnpm = (...args) => manager("pnpm", args);

const product = async () =>
  JSON.parse(await readFile(path.join(checkout, "product.json"), "utf8"));

function requireWindows() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(
      "Windows desktop builds currently require Windows x64 with x64 Node.js.",
    );
  }
}

async function ensureDependencies() {
  const required = (
    await readFile(path.join(checkout, ".nvmrc"), "utf8")
  ).trim();

  if (process.versions.node !== required) {
    throw new Error(
      `Code OSS requires Node ${required}; active Node is ${process.versions.node}.`,
    );
  }

  const stamp = path.join(
    checkout,
    "node_modules/.dev-fast-package-lock.sha256",
  );

  const digest = await lockfileDigest(checkout);

  if (
    needsDependencyInstall({
      dependencyDirectoriesExist: dependencyDirectoriesExist(checkout),
      installedLockfileDigest: await readFile(stamp, "utf8")
        .then((value) => value.trim())
        .catch(() => undefined),
      lockfileDigest: digest,
    })
  ) {
    await npm("ci", "--no-audit", "--no-fund", "--prefer-offline");
    await writeFile(stamp, digest);
  }
}

async function buildReview() {
  if (process.env.REVIEW_POSTHOG_KEY) {
    await node(path.join(review, "scripts/embed-posthog-key.mjs"));
  }

  await pnpm("--filter", "@dev.fast/review", "build");
  await pnpm("--filter", "@dev.fast/review-canvas", "build");
  await pnpm("--filter", "@dev.fast/review", "build:tutorial-assets");
}

async function ensureElectron() {
  const identity = await product();
  const electronRoot = path.join(checkout, ".build/electron");
  const npmrc = await readFile(path.join(checkout, ".npmrc"), "utf8");
  const target = npmrc.match(/^target="([^"]+)"/m)?.[1];

  const installed = await readFile(path.join(electronRoot, "version"), "utf8")
    .then((value) => value.trim().replace(/^v/, ""))
    .catch(() => undefined);

  if (
    !existsSync(path.join(electronRoot, `${identity.nameShort}.exe`)) ||
    installed !== target
  ) {
    await npm("run", "electron");
  }
}

export async function build() {
  requireWindows();
  await ensureDependencies();
  const purify = "vs/base/browser/dompurify/cgmanifest.json";
  await mkdir(path.dirname(path.join(checkout, "out", purify)), {
    recursive: true,
  });
  await copyFile(
    path.join(checkout, "src", purify),
    path.join(checkout, "out", purify),
  );
  await node(path.join(scripts, "curated-extensions.mjs"), [
    "--target=win32-x64",
    ...(process.env.REVIEW_DESKTOP_DEV_FAST === "1"
      ? [`--only=${process.env.DEV_REVIEW_EXTENSIONS || "all"}`]
      : []),
  ]);

  if (process.env.REVIEW_DESKTOP_COMPILE_ONLY !== "1") await ensureElectron();
  await node(path.join(scripts, "protocol-sync.mjs"));

  if (
    process.env.REVIEW_DESKTOP_CI_FAST === "1" ||
    process.env.REVIEW_DESKTOP_DEV_FAST === "1"
  ) {
    await npm("run", "gulp", "copy-codicons");
    await npm("run", "transpile-client");
    await npm("run", "gulp", "compile-extensions", "compile-extension-media");

    if (process.env.REVIEW_DESKTOP_CI_FAST === "1")
      await npm("run", "typecheck-client");
  } else {
    await npm("run", "compile");
  }

  for (const entry of ["reviewProtocol.js", "reviewEventStream.js"]) {
    const output = path.join(checkout, "out/vs/review/common", entry);
    await node(
      path.join(
        root,
        "packages/review-protocol/scripts/bundle-native-runtime.mjs",
      ),
      [output, output],
    );
  }

  await buildReview();
  await node(path.join(scripts, "copy-canvas.mjs"));
}

export function launchOptions({
  product,
  packagedRoot,
  stateRoot,
  environment = process.env,
}) {
  const packaged = Boolean(packagedRoot);

  const executable = path.resolve(
    packagedRoot || path.join(checkout, ".build/electron"),
    `${product.nameShort}.exe`,
  );

  const env = {
    ...environment,
    DEV_FAST_REVIEW_CHECKOUT: root,
    ELECTRON_ENABLE_STACK_DUMPING: "1",
    ELECTRON_ENABLE_LOGGING: "1",
  };

  const args = [
    "--disable-extension=vscode.vscode-api-tests",
    "--disable-telemetry",
    "--skip-welcome",
    `--user-data-dir=${path.resolve(stateRoot, "user-data")}`,
    `--extensions-dir=${path.resolve(stateRoot, "extensions")}`,
  ];

  if (environment.DEV_FAST_REVIEW_SHARED_DATA_DIR)
    args.push(
      `--shared-data-dir=${environment.DEV_FAST_REVIEW_SHARED_DATA_DIR}`,
    );

  if (environment.DEV_FAST_REVIEW_REMOTE_DEBUGGING_PORT)
    args.push(
      `--remote-debugging-port=${environment.DEV_FAST_REVIEW_REMOTE_DEBUGGING_PORT}`,
    );

  if (environment.DEV_FAST_REVIEW_DISABLE_GPU === "1")
    args.push("--disable-gpu");

  if (environment.DEV_FAST_REVIEW_FORCE_ACCESSIBILITY === "1")
    args.push("--force-renderer-accessibility");

  if (packaged) {
    for (const key of [
      "NODE_ENV",
      "VSCODE_DEV",
      "VSCODE_CLI",
      "DEV_FAST_REVIEW_SERVER_ENTRY",
      "DEV_FAST_REVIEW_TOOLING_ROOT",
    ])
      delete env[key];
  } else {
    Object.assign(env, {
      NODE_ENV: "development",
      VSCODE_DEV: "1",
      VSCODE_CLI: "1",
      DEV_FAST_REVIEW_SERVER_ENTRY: path.join(
        review,
        "dist/server/desktop-host.js",
      ),
      DEV_FAST_REVIEW_TOOLING_ROOT: root,
    });
    args.push(".");
  }

  return { executable, args, env };
}

export async function run() {
  requireWindows();
  const packagedRoot = process.env.DEV_FAST_REVIEW_PACKAGED_ROOT;

  const stateRoot =
    process.env.DEV_FAST_REVIEW_DESKTOP_STATE_ROOT ||
    path.join(
      process.env.DEV_REVIEW_HOME || path.join(os.homedir(), ".dev"),
      "review-desktop/state",
    );

  const launch = launchOptions({
    product: await product(),
    packagedRoot,
    stateRoot,
  });

  if (!existsSync(launch.executable))
    throw new Error(
      `Desktop binary missing: ${launch.executable}. Run pnpm desktop:build first.`,
    );

  for (const name of ["user-data", "extensions", "logs"])
    await mkdir(path.join(stateRoot, name), { recursive: true });

  if (!packagedRoot) {
    await node(path.join(scripts, "curated-extensions.mjs"), [
      `--only=${process.env.DEV_REVIEW_EXTENSIONS || "all"}`,
    ]);

    if (!process.env.REVIEW_DIFFR_BINARY)
      await pnpm("--filter", "@dev.fast/review", "ensure:diffr", "--required");
    await node(path.join(scripts, "copy-canvas.mjs"));
    await node(path.join(checkout, "build/lib/preLaunch.ts"), [], {
      cwd: checkout,
    });
  }

  if (process.env.DEV_FAST_REVIEW_DESKTOP_BACKGROUND === "1") {
    const child = spawn(launch.executable, launch.args, {
      cwd: checkout,
      env: launch.env,
      stdio: "ignore",
      detached: true,
    });

    child.on("error", (error) => {
      throw error;
    });
    child.unref();
  } else {
    await execute(launch.executable, launch.args, {
      cwd: checkout,
      env: launch.env,
    });
  }
}

export async function packageWindows() {
  requireWindows();

  if (!existsSync(path.join(checkout, "node_modules/gulp/bin/gulp.js")))
    throw new Error("Run pnpm desktop:build before packaging.");
  process.env.BUILD_SOURCEVERSION ||= execFileSync(
    "git",
    ["rev-parse", "HEAD"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  await node(path.join(scripts, "curated-extensions.mjs"), [
    "--target=win32-x64",
  ]);
  await npm("run", "gulp", "--", "vscode-win32-x64");
  const packagedRoot = path.join(app, "VSCode-win32-x64");
  const identity = await product();

  if (!existsSync(path.join(packagedRoot, `${identity.nameShort}.exe`)))
    throw new Error("Windows packaging did not create the desktop executable.");
  await buildReview();
  await node(path.join(scripts, "copy-canvas.mjs"), [
    "--packaged-root",
    packagedRoot,
  ]);
  await node(path.join(scripts, "curated-extensions.mjs"), [
    "--target=win32-x64",
    "--copy-to",
    path.join(packagedRoot, "resources/app/extensions"),
  ]);
  await pnpm("--filter", "@dev.fast/review", "ensure:diffr", "--required");
  await node(path.join(scripts, "stage-review-runtime.mjs"), [
    "--packaged-root",
    packagedRoot,
  ]);
  await node(path.join(scripts, "stage-review-runtime.mjs"), [
    "--verify",
    "--packaged-root",
    packagedRoot,
  ]);

  const destination = path.join(
    root,
    "dist",
    `${identity.nameShort.replaceAll(" ", "-")}-win32-x64-${identity.reviewVersion}.zip`,
  );

  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { force: true });
  await execute("tar.exe", ["-a", "-cf", destination, "-C", packagedRoot, "."]);
  console.log(`Windows package: ${destination}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv[2] !== "package" || process.argv.length !== 3)
    throw new Error("usage: windows.mjs package");
  await packageWindows();
}
