#!/usr/bin/env node
/**
 * Generate the public catalogue the web page reads.
 *
 * GitHub Pages serves `docs/` as the site root, so the page cannot reach
 * `../art/looks.json`. Rather than duplicate the declaration into the page — two
 * copies that would drift — this writes the public subset of it into the site
 * folder, and the page fetches that.
 *
 *   npm run build:site
 *
 * Only fields that are safe and useful in public are copied: identities, names,
 * the theme key and whether a look animates. Rights lines and source URLs stay in
 * the repository.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const declaration = JSON.parse(readFileSync(join(root, "art", "looks.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** The generated art index, when it exists, says which looks actually animate. */
let indexed = { looks: [] };
try {
  indexed = JSON.parse(readFileSync(join(root, "art", "index.json"), "utf8"));
} catch {
  /* no index yet — the page falls back to the declaration's own frame lists */
}

const animated = new Set(indexed.looks.filter((look) => look.animated).map((look) => look.id));

const catalog = {
  version: manifest.version,
  repository: "https://github.com/ZYAONS/dsh-plugin-mascot",
  characters: declaration.characters.map((character) => ({
    id: character.id,
    name: character.name,
    latin: character.latin,
    role: character.role,
    tagline: character.tagline,
    theme: character.theme,
    looks: declaration.looks
      .filter((look) => look.character === character.id)
      .map((look) => look.id),
  })),
  looks: declaration.looks.map((look) => ({
    id: look.id,
    character: look.character,
    name: look.name,
    animated: animated.has(look.id) || (look.frames ?? []).length > 1,
  })),
};

const target = join(root, "docs", "site", "catalog.json");
writeFileSync(target, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`build-site: wrote ${target} (${String(catalog.characters.length)} characters, ${String(catalog.looks.length)} looks)`);
