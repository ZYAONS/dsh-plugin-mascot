#!/usr/bin/env node
/**
 * Pre-flight check for the live DSH profile.
 *
 * A plugin that is only mounted after an app restart is hard to debug, so this
 * verifies everything that can be verified *before* restarting:
 *
 *   1. the profile's `cordis.patch.yml` parses as a top-level YAML array;
 *   2. its `insert` rows resolve to a real module, the way the loader resolves
 *      them (absolute path, `file:` URL, or a name relative to the patch file);
 *   3. that module imports cleanly and exports the cordis plugin surface;
 *   4. the package it belongs to declares the browser half the way
 *      `client-modules` discovers it, and that bundle is present.
 *
 *   node scripts/verify-profile.mjs [profileDir]
 *
 * Defaults to `~/.dsh/profiles/desktop`.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const profileDir = process.argv[2] ?? join(homedir(), ".dsh", "profiles", "desktop");
const patchFile = join(profileDir, "cordis.patch.yml");

// `yaml` ships with DSH rather than with this plugin, so borrow the copy the
// app itself uses instead of adding a dependency.
const DSK_YAML = "D:/dsdesktop/DSH Desktop/resources/app.asar.unpacked/node_modules/yaml/dist/index.js";
const require = createRequire(import.meta.url);
let YAML;
for (const candidate of [pathToFileURL(DSK_YAML).href]) {
  if (existsSync(fileURLToPath(candidate))) {
    YAML = await import(candidate);
    break;
  }
}
if (YAML === undefined) {
  try {
    YAML = require("yaml");
  } catch {
    console.error("verify-profile: cannot find the `yaml` parser (pass its path or install it)");
    process.exit(1);
  }
}

let failures = 0;
const ok = (message) => console.log(`  ok  ${message}`);
const bad = (message) => {
  failures += 1;
  console.error(`  FAIL  ${message}`);
};

if (!existsSync(patchFile)) {
  bad(`no patch file at ${patchFile}`);
  process.exit(1);
}

const parsed = YAML.parse(readFileSync(patchFile, "utf8"));
if (!Array.isArray(parsed)) {
  bad("cordis.patch.yml must be a top-level YAML array");
  process.exit(1);
}
ok(`cordis.patch.yml parses as an array of ${String(parsed.length)} patch entries`);

/** Top-level `insert` rows are pushed verbatim, exactly as applyEntryPatches does. */
const rows = parsed.flatMap((patch) => (Array.isArray(patch?.insert) && patch.id === undefined ? patch.insert : []));
if (rows.length === 0) {
  bad("no top-level `insert` rows found — the plugin would never mount");
}

/** Resolve an entry `name` the way the loader does. */
function resolveEntry(name) {
  if (name.startsWith("file:")) return fileURLToPath(name);
  if (isAbsolute(name)) return name;
  if (name.startsWith(".")) return resolve(dirname(patchFile), name);
  return undefined;
}

for (const row of rows) {
  if (typeof row?.name !== "string") {
    bad(`entry ${JSON.stringify(row?.id)} has no module name`);
    continue;
  }
  const path = resolveEntry(row.name);
  if (path === undefined) {
    console.log(`  --  ${String(row.id)}: bare name ${row.name} (resolved through the profile's node_modules)`);
    continue;
  }
  if (!existsSync(path)) {
    bad(`${String(row.id)}: no module at ${path}`);
    continue;
  }
  const module = await import(pathToFileURL(path).href);
  if (typeof module.apply !== "function") {
    bad(`${String(row.id)}: ${path} exports no apply()`);
    continue;
  }
  ok(`${String(row.id)}: ${path} loads and exports apply() (inject: ${JSON.stringify(module.inject ?? [])})`);

  // The browser half is discovered from the package manifest beside that module.
  let dir = dirname(path);
  let manifestPath;
  while (dir !== dirname(dir)) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      manifestPath = candidate;
      break;
    }
    dir = dirname(dir);
  }
  if (manifestPath === undefined) {
    bad(`${String(row.id)}: no package.json above ${path}, so no browser half can be discovered`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.dsh?.client?.platform !== "web") {
    bad(`${manifestPath}: dsh.client.platform must be "web"`);
    continue;
  }
  if (typeof manifest.exports?.["./client"] !== "string") {
    bad(`${manifestPath}: exports["./client"] must be a string`);
    continue;
  }
  if (manifest.exports["./package.json"] === undefined) {
    bad(`${manifestPath}: exports["./package.json"] is required for desktop client discovery`);
    continue;
  }
  const clientPath = join(dirname(manifestPath), manifest.exports["./client"]);
  if (!existsSync(clientPath)) {
    bad(`browser half missing at ${clientPath}`);
    continue;
  }
  const source = readFileSync(clientPath, "utf8");
  const registered = /__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/u.exec(source);
  if (registered === null) {
    bad(`${clientPath}: no __ModuleLoader__.load({ id }) registration`);
    continue;
  }
  if (registered[1] !== manifest.name) {
    bad(`${clientPath}: registered id "${registered[1]}" must equal the package name "${manifest.name}"`);
    continue;
  }
  ok(`browser half ${manifest.name} → ${clientPath} (served at /plugins/${manifest.name}/client.js)`);
}

console.log(failures === 0 ? "\nverify-profile: ready — restart DSH Desktop to mount" : `\nverify-profile: ${String(failures)} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
