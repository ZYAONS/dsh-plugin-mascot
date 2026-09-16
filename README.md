# dsh-plugin-mascot

English | [中文](README.zh.md)

A clickable mascot for the **DeepSeek Harness** (DSH) Web GUI. It sits quietly in
the bottom-right corner; click it and a panel opens with what the session has
actually cost you and how well the prompt cache is doing.

The mascots use **official Q-version (chibi) art** — Closure's Arknights Q-version
operator sprite and Sengoku Yuno's official Q-version design, drawn by the
publishers' artists rather than by this project. Because that artwork is
copyrighted, the repository ships **no images**, only a fetch script: run
`npm run fetch-art` once (see [Artwork](#artwork)).

- **Token cache-hit rate** — cache reads over every billed input bucket
- **Token breakdown** — uncached input / cache read / cache write / output / session total
- **Context occupancy** — current usage against the context window, with a bar
- **Account balance** — fetched host-side from DeepSeek; the API key never reaches the browser
- **Two characters, switchable** — **Closure** from *Arknights* and **Sengoku Yuno** from *BanG Dream!*'s Mugendai MewType

![preview](docs/preview.png)

> That preview is `lib/client.js` running in a real Chromium — opening the panels
> and switching characters are genuine DOM clicks. It shows the **built-in
> placeholder**, i.e. exactly what a fresh clone looks like before
> `npm run fetch-art`. The version with the official artwork is
> `docs/preview-official.png`, generated locally and kept out of the repository.

---

## Contents

- [Install](#install)
- [Artwork](#artwork)
- [Usage](#usage)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Where the numbers come from](#where-the-numbers-come-from)
- [Development](#development)
- [Artwork and licensing](#artwork-and-licensing)

---

## Install

DSH Desktop loads plugins through the profile's **`cordis.patch.yml`**.
`cordis.yml` is rewritten to `[]` on every boot — **do not edit it**.

The plugin has **zero runtime dependencies** (the host half imports nothing at
all), so there are two ways in. Pick either.

### Option A — no install step (simplest)

Point the patch row straight at the host half with an absolute `file:` URL:

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: mascot
      name: 'file:///C:/Users/<you>/Desktop/kexier/dsh-plugin-mascot/lib/index.js'
```

Note: a `file:` URL must name a **file**, not the folder. A relative
`./dsh-plugin-mascot/lib/index.js` also works — it is anchored to the patch
file's own directory.

### Option B — a real profile dependency

Use DSH's own CLI, which forwards its arguments verbatim to pnpm inside the
profile directory:

```bash
dsh plugin --profile desktop add "/absolute/path/to/dsh-plugin-mascot"
```

`link:` / `file:` specs and git sources work too:

```bash
dsh plugin --profile desktop add link:/absolute/path/to/dsh-plugin-mascot
dsh plugin --profile desktop add "github:ZYAONS/dsh-plugin-mascot"
```

then mount it by package name:

```yaml
- insert:
    - id: mascot
      name: dsh-plugin-mascot
```

I prefer Option A: it cannot disturb the profile's dependency tree.

### Configuration

Add a `config` block to either form (see [Configuration](#configuration)):

```yaml
- insert:
    - id: mascot
      name: dsh-plugin-mascot
      config:
        baseUrl: 'https://api.deepseek.com'
        cacheTtlMs: 30000
```

### Restart DSH Desktop

**A full app restart is required.** DSH Desktop does not watch the profile
directory — `patchReload: live` only applies on the CLI path, and the desktop
composes its patch layers once per launch. Reloading the page is not enough:
the plugin was never part of that generation's load tree. After the first
mount, later edits to `lib/client.js` hot-reload through client HMR without
another restart.

---

## Artwork

The mascots use **official Q-version (chibi) art** drawn by the publishers'
artists. That artwork is owned by Hypergryph and Bushiroad, and committing it
here would redistribute someone else's copyrighted asset — so this repository
ships **the download manifest instead of the images**:

```bash
npm run fetch-art              # download into art/ per art/sources.json
npm run fetch-art -- --force   # re-download regardless of hash
```

| Character | Asset | Processing |
|---|---|---|
| Closure | *Arknights* official Q-version operator sprite (512×640, transparent, with her drone) | used as-is |
| Sengoku Yuno | *BanG Dream!* Mugendai MewType official Q-version design (first generation) | cut out automatically |

Yuno's source is a promotional sheet: two poses on a pink star with confetti.
`scripts/cutout.mjs` cleans it in a real browser — sample the background colour
from the edges, flood-fill inward, keep only the largest connected component
(the figure itself), then crop to it. `fetch-art` runs it automatically; the
steps are documented in the script.

Every entry in `art/sources.json` carries source URLs and a **sha256**. The
script verifies each download and reports loudly if an upstream file changed
(it still writes the file, so a moved asset never leaves you with nothing). A
cut-out entry records a `derivedSha256` for reference only, since PNG encoding
can differ between Chromium builds.

**It works without the artwork.** The plugin ships a **neutral placeholder** — a
dashed box with a generic "image missing" glyph — that takes over whenever the
official file 404s. The placeholder depicts no character.

**Swapping art**: replace the files at `art/closure.png` and `art/yuno.png`. To
change characters, edit `art`, `sprite` and `face` on the `MASCOTS` entries in
`lib/client.js`; both framing pairs are computed from each file's alpha bounding
box (`width` is the rendered image width; `left` / `top` are the offsets that
bring the figure, or just the head, into its seat).

---

## Usage

| Interaction | Result |
|---|---|
| Click the sprite | Toggle the panel |
| Click either mini portrait in the panel | Switch mascot (choice is stored in localStorage) |
| Click the backdrop or press `Esc` | Close the panel |
| Click "刷新" | Re-read the balance immediately (it also refreshes every 2 minutes while open) |

While open, the pill under the sprite shows the balance. If the lookup fails it
reads "点我 Token / 余额" instead of pretending to know.

---

## Configuration

Every field has a default, so the `config` block is optional.

| Field | Default | Meaning |
|---|---|---|
| `routePrefix` | `/dsh-mascot` | Path prefix this plugin claims on the host webserver |
| `baseUrl` | `https://api.deepseek.com` | Provider origin hosting the balance endpoint |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | Credentials reference name (`~/.dsh/.credentials.yaml`) |
| `cacheTtlMs` | `60000` | Freshness of one balance answer; failures are never cached |
| `timeoutMs` | `10000` | Upstream request budget |
| `artDir` | the plugin's own `art/` | Directory holding the artwork; derived from the plugin location |

> Behind a proxy or self-hosted gateway, point `baseUrl` at it — the only
> requirement is that it implements `GET /user/balance`.

---

## How it works

One package, two halves:

```
dsh-plugin-mascot/
├── lib/
│   ├── index.js        host half: the /dsh-mascot routes (balance + artwork)
│   └── client.js       browser half: sprite + panel (window.__ModuleLoader__ format)
├── art/
│   ├── sources.json    the official-artwork manifest (committed)
│   ├── closure.png     ← npm run fetch-art, gitignored
│   └── yuno.png        ← ditto, cut out on the way in
└── scripts/
    ├── fetch-art.mjs   downloads the official artwork into art/
    ├── cutout.mjs      flood-fills a background out in a real browser
    ├── chrome.mjs      Chromium discovery, shared by preview and cutout
    ├── check.mjs       self-test: manifest, bundle load, statistics, routes
    ├── preview.mjs     renders docs/preview*.png from the real code in a browser
    └── verify-profile.mjs  pre-flight for a live DSH profile
```

### Which seat the browser half takes

The DSH GUI is a **slot registry**. This plugin registers exactly one entry:

- **`shell.overlay`** — a frame-wide floating layer above every column and
  outside their scroll containers. It is a `list` slot, so a fresh
  `id: "mascot"` *adds* an entry instead of replacing one, and the layer itself
  is click-through, so the sprite opts back into pointer events rather than
  blocking the app underneath.

The wrinkle: `shell.overlay` is `root`-scoped and therefore **does not receive
`useProjection`**. So the entry **declares a `session-maybe`-scoped child slot
of its own** (`mascot.panel`) and renders the panel through
`props.renderSlot("mascot.panel", …)` — the renderer then hands that child
`useProjection` / `useSession` / `sessionId` for free. It is `session-maybe`
rather than `session` so the panel still opens before any session is selected.

### The host half

The balance is the one figure the browser cannot reach: answering it needs the
API key, and the key must never leave the host process. The artwork is the other
one — the official files are not in the repository, so something has to read them
off disk. So the host half owns one same-origin route prefix:

```
GET /dsh-mascot/api/balance   account balance, cached
GET /dsh-mascot/api/health    route liveness, for debugging
GET /dsh-mascot/art/<file>    artwork out of the plugin's own art/ directory
```

- The key is resolved per request through `ctx.credentials.resolve()`, so a
  **rotated key takes effect on the next call** with no restart;
- it is used only as an `Authorization: Bearer` header and **never** appears in
  a response body, a log line, or an error message;
- the routes are gated on `ctx.connection.isAuthenticated(req)` — the same
  browser cookie the rest of the GUI uses. If Connection is absent from the
  composition they fall back to accepting only a loopback `Host` header;
- the artwork route checks path containment first (`..`, encoded separators →
  403), then the extension, and only then touches the disk. A missing file is a
  404, which the browser half turns into the vector fallback.

---

## Where the numbers come from

Every figure in the panel comes from DSH's own **session projections**; the
plugin does not count tokens itself.

| Shown | Source | Shape |
|---|---|---|
| Token breakdown | `useProjection("tokenUsage")` | `{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }` |
| Cache-hit rate | derived from the row above | `cacheReadTokens ÷ (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)` |
| Context occupancy | `useProjection("contextPressure")` | `{ contextWindow?, pressureTokens?, projectedTokens? }`, preferring `projectedTokens` |
| Account balance | this plugin's `/dsh-mascot/api/balance` | `GET {baseUrl}/user/balance` |
| Artwork | this plugin's `/dsh-mascot/art/<file>` | `art/` on disk, with the built-in vector art as fallback |

Anything unmeasurable renders as `—` rather than `0`: with no session there is
no hit rate to report, and the panel does not invent one.

---

## Development

```bash
npm install                # react / react-dom, devDependencies for the preview only
npm run fetch-art          # download the official Q-version art into art/
npm test                   # self-test (22 checks)
npm run check              # node --check on both halves plus the self-test
npm run preview            # docs/preview.png — placeholder, committed
npm run preview:official   # docs/preview-official.png — official art, gitignored
npm run verify             # pre-flight the current DSH profile
```

Running the cut-out pass on its own:

```bash
node scripts/cutout.mjs <sheet.png> <out.png>
```

To re-frame the artwork, tune `sprite` and `face` on the `MASCOTS` entries in
`lib/client.js`, then `npm run preview:official` to look at it and restart DSH to
see it in place. The numbers come from measuring each file's alpha bounding box,
scaling it to the seat, and centring it.

To change the placeholder: edit `PLACEHOLDER_SVG` in `lib/client.js`.

---

## Artwork and licensing

- **Code**: [MIT](LICENSE)
- **Official Q-version artwork (`art/`, not committed)**: Closure's *Arknights*
  official Q-version operator sprite and Sengoku Yuno's official *BanG Dream!*
  Q-version design. **The rights belong to their respective owners; this is
  publisher-commissioned art, not fan art.** This repository does not distribute
  those files; it ships the `art/sources.json` manifest and the
  `npm run fetch-art` script so each user downloads them onto their own machine.
  Fine for personal use — **get permission before redistributing or using
  commercially.** Yuno's file passes through `scripts/cutout.mjs`, which removes
  a background and a second pose; that is pixel processing and changes no content.
- **Built-in placeholder**: the generic "image missing" glyph in `lib/client.js`
  (a dashed box plus a picture symbol). It depicts no character and is MIT
  alongside the code.
- **Characters**: Closure © Hypergryph (*Arknights*); Sengoku Yuno © Bushiroad
  (*BanG Dream!* / Mugendai MewType). Both are the property of their respective
  owners. This is an unofficial fan work with no affiliation or endorsement.
- **DSH**: DeepSeek Harness and its `@deepseek-ai/*` packages belong to their
  respective authors; this repository only builds against its plugin surface.
