/**
 * Chromium discovery shared by the scripts that need a real browser.
 *
 * `preview.mjs` renders the panel and `cutout.mjs` keys a background out of an
 * image; both need the same "find a Chromium binary or fail clearly" step, and
 * neither should grow its own copy of the candidate list.
 */

import { existsSync } from "node:fs";

const CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/**
 * Locate a Chromium binary.
 * @returns the executable path.
 * @throws when none of the known locations exists.
 */
export function findChromium() {
  const found = CANDIDATES.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`no Chromium binary found; looked in:\n  ${CANDIDATES.join("\n  ")}`);
  }
  return found;
}
