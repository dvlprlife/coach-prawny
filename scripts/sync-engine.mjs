// Copies the Stockfish worker + its .wasm out of node_modules into public/engine/.
//
// Why this exists at all: the engine is *served* rather than bundled, because
// the .wasm has to sit next to its .js loader at a stable URL for the Web
// Worker to fetch it (see src/App.tsx). Vite copies public/ verbatim, so
// public/engine/ is the staging area.
//
// Why it is a Node script and not a one-line `mkdir -p && cp`: that shell form
// only works on Unix. npm runs scripts through cmd.exe on Windows, where
// `mkdir -p public/engine` silently creates a stray directory literally named
// `-p` AND exits 0, then `cp` does not exist and the script dies half-done.
// Windows is the primary dev platform here, so the portable form is the only
// one that actually runs everywhere.
//
// This runs from `prebuild` and `predev`, so public/engine/ is always
// regenerated from the version pinned in package-lock.json. That is what keeps
// a Dependabot bump of `stockfish` from leaving stale binaries behind.

import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = [
  "stockfish-18-lite-single.js",
  "stockfish-18-lite-single.wasm",
];

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(projectRoot, "public", "engine");

// Locate the installed stockfish package. Prefer real module resolution so a
// hoisted / non-standard node_modules layout still works; fall back to the
// conventional path if the package restricts its "exports" map.
function findStockfishBinDir() {
  const require = createRequire(import.meta.url);
  try {
    return join(dirname(require.resolve("stockfish/package.json")), "bin");
  } catch {
    return join(projectRoot, "node_modules", "stockfish", "bin");
  }
}

const srcDir = findStockfishBinDir();

if (!existsSync(srcDir)) {
  console.error(
    `sync-engine: cannot find the stockfish package at ${srcDir}\n` +
      `Run \`npm install\` first.`
  );
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

for (const name of FILES) {
  const from = join(srcDir, name);
  const to = join(destDir, name);

  // A missing source file means the stockfish package changed its filenames —
  // almost certainly a major bump. Fail loudly here rather than shipping a
  // dist/ whose engine 404s at runtime.
  if (!existsSync(from)) {
    console.error(
      `sync-engine: expected engine file not found: ${from}\n` +
        `The installed stockfish package no longer ships this filename. Check ` +
        `its release notes, then update FILES in scripts/sync-engine.mjs, the ` +
        `stockfishUrl in src/App.tsx, and the assertions in ` +
        `.github/workflows/build.yml together.`
    );
    process.exit(1);
  }

  copyFileSync(from, to);
  const kb = (statSync(to).size / 1024).toFixed(1);
  console.log(`sync-engine: ${name} (${kb} KB)`);
}
