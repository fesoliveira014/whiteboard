import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  bundledExtensions,
  bundledGroups,
  curatedExtensions,
  curatedGroups,
  defaultDisabledIds,
  keymapGroups,
  openVsxUrl,
  optionalExtensions,
  parseGroupSelection,
  supportedTargets,
  targetKeyFor,
} from "./curated-extensions.manifest.mjs";
import {
  copyCuratedExtensions,
  extensionExecutables,
  verifyCuratedExtensions,
} from "./curated-extensions.mjs";

const APP_DIR = path.dirname(fileURLToPath(new URL("./", import.meta.url)));

const EXTENSIONS_DIR = path.join(APP_DIR, "code-oss", "extensions");

async function loadImportFreeTypeScriptModule(url) {
  const source = await readFile(url, "utf8");

  const emitted = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;

  return import(
    `data:text/javascript;base64,${Buffer.from(emitted).toString("base64")}`
  );
}

const mainOptionalCatalog = (
  await loadImportFreeTypeScriptModule(
    new URL(
      "../code-oss/src/vs/review/node/reviewOptionalExtensionCatalog.ts",
      import.meta.url,
    ),
  )
).reviewOptionalExtensionCatalog;

test("pins every curated extension to a checksum for every supported target", () => {
  assert.ok(curatedExtensions.length > 0);

  for (const extension of curatedExtensions) {
    assert.equal(
      extension.id,
      `${extension.namespace}.${extension.name}`.toLowerCase(),
      `${extension.id} must be <namespace>.<name> lowercased`,
    );
    assert.ok(curatedGroups.includes(extension.group), `${extension.id} group`);
    assert.ok(
      ["bundled", "optional"].includes(extension.tier),
      `${extension.id} tier`,
    );
    assert.match(extension.version, /^\d/, `${extension.id} version`);

    const targetKeys = Object.keys(extension.targets);

    if (extension.targets.universal) {
      assert.deepEqual(targetKeys, ["universal"], `${extension.id} targets`);
    } else {
      assert.deepEqual(
        targetKeys.sort(),
        [...supportedTargets].sort(),
        `${extension.id} must pin every supported target`,
      );
    }

    for (const [targetKey, target] of Object.entries(extension.targets)) {
      assert.match(
        target.sha256,
        /^[0-9a-f]{64}$/,
        `${extension.id} ${targetKey} sha256`,
      );

      if (extension.tier === "optional") {
        assert.equal(
          target.url,
          openVsxUrl({
            namespace: extension.namespace,
            name: extension.name,
            version: extension.version,
            target: targetKey === "universal" ? undefined : targetKey,
          }),
          `${extension.id} ${targetKey} url`,
        );
        assert.ok(
          Number.isSafeInteger(target.size) && target.size > 0,
          `${extension.id} ${targetKey} size`,
        );
      }
    }
  }
});

test("keeps every optional pin identical in build, main, and renderer catalogs", () => {
  const normalize = (catalog) =>
    catalog
      .flatMap((extension) =>
        Object.entries(extension.targets).map(([target, pin]) => ({
          id: extension.id,
          role: extension.role,
          group: extension.group,
          version: extension.version,
          target,
          url: pin.url,
          sha256: pin.sha256,
          size: pin.size,
        })),
      )
      .sort((left, right) =>
        `${left.id}:${left.target}`.localeCompare(
          `${right.id}:${right.target}`,
        ),
      );

  const buildPins = normalize(optionalExtensions);
  assert.deepEqual(normalize(mainOptionalCatalog), buildPins);
});

test("keeps the curated identifiers unique", () => {
  const ids = curatedExtensions.map((extension) => extension.id);
  assert.deepEqual(ids, [...new Set(ids)], "duplicate curated extension id");
});

test("disables only the conflicting keymaps by default", () => {
  assert.deepEqual([...keymapGroups], ["vim", "emacs"]);
  assert.deepEqual([...defaultDisabledIds].sort(), [
    "tuttieee.emacs-mcx",
    "vscodevim.vim",
  ]);
});

test("builds Open VSX download urls for universal and per-platform builds", () => {
  assert.equal(
    openVsxUrl({ namespace: "vscodevim", name: "vim", version: "1.32.4" }),
    "https://open-vsx.org/api/vscodevim/vim/1.32.4/file/vscodevim.vim-1.32.4.vsix",
  );
  assert.equal(
    openVsxUrl({
      namespace: "rust-lang",
      name: "rust-analyzer",
      version: "0.4.2990",
      target: "darwin-arm64",
    }),
    "https://open-vsx.org/api/rust-lang/rust-analyzer/darwin-arm64/0.4.2990/file/rust-lang.rust-analyzer-0.4.2990@darwin-arm64.vsix",
  );
});

test("resolves a target key for every extension on every supported target", () => {
  for (const target of supportedTargets) {
    for (const extension of curatedExtensions) {
      assert.ok(
        targetKeyFor(extension, target),
        `${extension.id} has no build for ${target}`,
      );
    }
  }
});

test("parses DEV_REVIEW_EXTENSIONS selections", () => {
  assert.deepEqual(
    [...parseGroupSelection(undefined)].sort(),
    [...bundledGroups].sort(),
  );
  assert.deepEqual(
    [...parseGroupSelection("all")].sort(),
    [...bundledGroups].sort(),
  );
  assert.deepEqual([...parseGroupSelection("none")], []);
  assert.deepEqual([...parseGroupSelection("rust, vim")].sort(), [
    "rust",
    "vim",
  ]);
  assert.throws(() => parseGroupSelection("nope"), /unknown extension group/);
});

// The payloads are downloaded rather than committed, so a clean checkout has
// nothing to inspect. When they are present, hold them to the contract the
// materialize step promises.
const materialized = curatedExtensions.filter((extension) =>
  existsSync(path.join(EXTENSIONS_DIR, extension.id, "package.json")),
);

test(
  "materialized extensions match their pinned manifest entry",
  { skip: materialized.length === 0 && "no curated extensions materialized" },
  () => {
    for (const extension of materialized) {
      const directory = path.join(EXTENSIONS_DIR, extension.id);

      const stamp = JSON.parse(
        readFileSync(path.join(directory, ".curated.json"), "utf8"),
      );

      assert.equal(stamp.id, extension.id);
      assert.equal(stamp.version, extension.version);
      assert.equal(stamp.sha256, extension.targets[stamp.target].sha256);

      const manifest = JSON.parse(
        readFileSync(path.join(directory, "package.json"), "utf8"),
      );

      assert.equal(
        manifest.dependencies,
        undefined,
        `${extension.id} dependencies`,
      );
      assert.equal(manifest.scripts, undefined, `${extension.id} scripts`);

      if (extension.stripExtensionPack) {
        assert.equal(
          manifest.extensionPack,
          undefined,
          `${extension.id} extensionPack`,
        );
      }

      for (const activationEvent of extension.addActivationEvents ?? []) {
        assert.ok(
          manifest.activationEvents.includes(activationEvent),
          `${extension.id} must declare ${activationEvent}`,
        );
      }

      for (const relative of extensionExecutables(extension, stamp.target)) {
        const executable = path.join(directory, relative);
        assert.ok(
          existsSync(executable),
          `${extension.id} is missing ${relative}`,
        );

        if (process.platform !== "win32") {
          assert.ok(
            statSync(executable).mode & 0o111,
            `${extension.id} ${relative} must stay executable`,
          );
        }
      }
    }
  },
);

test("copies only bundled extensions for every package target", () => {
  for (const target of supportedTargets) {
    const root = mkdtempSync(path.join(os.tmpdir(), "review-curated-copy-"));
    const sourceRoot = path.join(root, "source");
    const destinationRoot = path.join(root, "destination");

    try {
      for (const extension of bundledExtensions) {
        const targetKey = targetKeyFor(extension, target);
        assert.ok(targetKey, `${extension.id} must support ${target}`);
        const directory = path.join(sourceRoot, extension.id);
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          path.join(directory, "package.json"),
          `${JSON.stringify({
            publisher: extension.namespace,
            name: extension.name,
            version: extension.version,
            activationEvents: extension.addActivationEvents ?? [],
          })}\n`,
        );
        writeFileSync(
          path.join(directory, ".curated.json"),
          `${JSON.stringify({
            id: extension.id,
            version: extension.version,
            target: targetKey,
            sha256: extension.targets[targetKey].sha256,
          })}\n`,
        );

        for (const relative of extensionExecutables(extension, targetKey)) {
          const executable = path.join(directory, relative);
          mkdirSync(path.dirname(executable), { recursive: true });
          writeFileSync(executable, "fixture\n");
          chmodSync(executable, 0o755);
        }
      }

      copyCuratedExtensions({ destinationRoot, sourceRoot, target });
      verifyCuratedExtensions({ root: destinationRoot, target });

      for (const extension of bundledExtensions) {
        assert.ok(
          existsSync(path.join(destinationRoot, extension.id, "package.json")),
          `${extension.id} must reach the ${target} destination`,
        );
      }

      for (const extension of optionalExtensions) {
        assert.ok(
          !existsSync(path.join(destinationRoot, extension.id)),
          `${extension.id} must stay out of the ${target} package`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
