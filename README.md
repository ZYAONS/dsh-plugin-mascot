# dsh-plugin-mascot

English | [中文](README.zh.md)

A clickable mascot for the **DeepSeek Harness** (DSH) Web GUI. It sits quietly in
the bottom-right corner; click it and a panel opens with what the session has
actually cost you and how well the prompt cache is doing.

- **Token cache-hit rate** — cache reads over every billed input bucket
- **Token breakdown** — uncached input / cache read / cache write / output / session total
- **Context occupancy** — current usage against the context window, with a bar
- **Account balance** — fetched host-side from DeepSeek; the API key never reaches the browser
- **Two characters, five official looks, switchable** — Closure (*Arknights*) and Sengoku Yuno (*BanG Dream!*)
- **One interface style per character** — a Rhodes Island engineering console and a
  MEWTYPE live set are two designs, not a hue swap
- **The sprite is skeletally animated** — auto-rigged from its silhouette and driven by a
  skinned mesh: breathing, weight shifts, head leading; the two-frame Q-version look
  genuinely **turns around**

![preview](docs/preview.png)

> That preview is `lib/client.js` running in a real Chromium — opening panels,
> switching characters and switching looks are genuine DOM clicks. It shows the
> **built-in placeholder**, i.e. exactly what a fresh clone looks like before
> `npm run fetch-art`. The version with the official artwork is
> `docs/preview-official.png`, generated locally and kept out of the repository.

---

## Contents

- [Install](#install)
- [Looks](#looks)
- [Style](#style)
- [Motion](#motion)
- [Usage](#usage)
- [Configuration](#configuration)
- [Web console](#web-console)
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

## Web console

Decide how this plugin is mounted and which character it wears **in a browser**,
before anything is installed on the machine:

**https://zyaons.github.io/dsh-plugin-mascot/**

![console](docs/site/preview.png)

- **01 Plugin** — the plugin itself on/off, and the balance lookup on/off
- **02 Character** — Closure (Rhodes Island console) or Sengoku Yuno (MEWTYPE LIVE)
- **03 Looks** — tick which artwork may appear; an unticked look goes into an
  allowlist, so the plugin will not even list it
- **04 Motion** — the bone rig, and multi-frame looks
- **05 Output** — a ready-to-paste `cordis.patch.yml`, with copy and download
- **06 Install** — five steps, including fetching the artwork and restarting

### Two page themes

The console carries both characters' interface styles, switchable from the header,
and they are not a hue swap:

| | Closure | Yuno |
|---|---|---|
| Ground | blue-black | purple-black |
| Signal | cyan `#37e0d8` | magenta `#ff4d9d` |
| Corners | square | 14px rounded |
| Selection cue | corner brackets | a glow |
| Labels | monospace | rounded |
| Hazard tape | cyan | magenta |

**Follow the character** is the default, so picking Yuno in section 02 recolours the
page — which makes the console a live preview of what the plugin will look like.
Choosing a theme explicitly pins it.

Both are deep-linkable, which is also what makes them testable without driving
clicks:

```
?theme=auto|closure|yuno      ?character=closure|yuno
```

The page is **purely static**, hosted on GitHub Pages. It runs no server code and
**does not read or modify anything on your machine** — it turns your choices into a
YAML string. State lives in your browser's localStorage.

The palette and typography borrow from tactical-UI design generally (near-black
ground, one signal colour, hairline rules, uppercase Latin labels over Chinese
ones). **No game asset, logo or typeface is used.**

Its catalogue comes from `docs/site/catalog.json`, which `scripts/build-site.mjs`
generates from `art/looks.json` — the same declaration the plugin reads, so the two
cannot drift. `scripts/check-site.mjs` drives the page in a real browser and asserts
that the catalogue loads, the controls render, that the two themes differ in
substance (six tokens compared, not just the accent), and that **every id in the
YAML it produces actually exists** (one typo there would make the plugin silently
fall back to its first look).

---

## Looks

The mascots use **official art drawn by the publishers' artists**, not by this
project. That artwork is owned by Hypergryph and Bushiroad, and committing it here
would redistribute someone else's copyrighted asset — so the repository ships
**the declaration instead of the images**:

```bash
npm run fetch-art              # download, cut out where needed, then re-index
npm run fetch-art -- --force   # re-download regardless of hash
```

| Character | Look | Asset | Processing |
|---|---|---|---|
| Closure | Chibi | Official Q-version operator sprite (512×640, transparent, drone included) | as-is |
| Closure | Portrait | Official operator art (1024×1024, transparent) | as-is |
| Yuno | Anime | Official anime art (1550×2085, transparent) | as-is |
| Yuno | Casual | Official anime everyday-clothes art — the pink-haired, glasses design (1499×2088, transparent) | as-is |
| Yuno | Q-version | Official first-generation Q-version sheet, two poses | **cut out → split into 2 frames** |

`art/looks.json` is the hand-authored declaration; `art/index.json` is the
generated index. Every entry carries source URLs and a **sha256**, verified on
download, with a loud report when an upstream file changes.

### Adding a look

No code changes:

1. add an entry to `looks` in `art/looks.json` (`id` / `character` / `name` / `urls` / `rights`);
2. `npm run fetch-art`.

`scripts/art-sync.mjs` measures each image's **alpha bounding box** in a real
browser, derives the framing for both seats (the 104×172 sprite and the 38×50
portrait), and samples an accent colour from the figure. So **the framing numbers
and the palette are measured, not hand-tuned**. The result lands in
`art/index.json`, which the host half reads, filters to what is actually on disk,
and serves to the browser.

### It syncs itself

- `npm run fetch-art` calls `art-sync` when it finishes, so the index is never stale;
- `npm run art:sync` re-measures on demand;
- `npm run art:watch` watches `art/` and **re-indexes the moment you drop an image
  in** — refresh the page and the new look is there, with no restart and no edit.

### It works without the artwork

A **neutral placeholder** — a dashed box with a generic "image missing" glyph —
takes over whenever a file 404s, and the panel says to run `fetch-art`. The
placeholder depicts no character.

---

## Style

**One interface style per character**, and not a colour swap: the two themes differ
in shape language, how a ratio is drawn, ambient motion, portraiture and figure type.

| | Closure · Rhodes Island console | Yuno · MEWTYPE LIVE |
|---|---|---|
| Shape | Square (6px), instrument-like | Rounded (18px), gummy |
| Progress | **Segmented ticks**, like a gauge | **VU meter**, glowing |
| Ambient | A scanline sweeping through | A pulse ring plus a bouncing equaliser |
| Portrait | Rounded rectangle | Circle with a glow ring |
| Figures | Monospace, engineering readout | Rounded, stage energy |
| Header tag | `罗德岛 · 工程终端` | `MEWTYPE · LIVE` |

Themes live in `THEMES` in `lib/client.js` and are selected by the `theme` field a
character carries in `art/looks.json` — so a new character themes itself by naming one.

---

## Motion

The sprite moves in three layers. The first two are real motion; the third is the
browser playing a file.

### 1. Skeletal animation (on by default, switchable in the panel)

A small **2D bone + skinned-mesh** renderer written for this plugin.

- **Automatic rigging.** `art-sync` also measures each image's **silhouette profile**
  (32 horizontal bands of left/right extents). The client finds the **neck** from it —
  the band where the silhouette pinches. It has to be *found* rather than assumed,
  because a chibi's head is most of the figure while a full-body portrait's head is a
  tenth of it, and no fixed fraction frames both.
- **Three bones in a chain.** `root` (pivot at the feet — the whole body's sway and
  bounce) → `spine` (pivot at the hip) → `neck` (pivot at the neck, carrying the
  head). Children inherit their parents' transforms, so the head **follows the body**
  instead of drifting independently.
- **Skinning.** Vertex weights are distributed **vertically only** — three bones
  stacked down the figure, blended across a smooth band at each joint — because that
  is the only axis a single flat image supports without tearing.
- **Rendering.** Linear blend skinning in WebGL2 (three weights per vertex). The
  texture is uploaded with `UNPACK_PREMULTIPLY_ALPHA_WEBGL`, so filtering across the
  figure's edge blends toward transparent black instead of leaving a dark fringe.
- **Deliberately small amplitudes.** Idle sway ±1.5°, nod ±2.4°, breathing ±1.1%, bob
  0.6%. Larger angles on a flat image read as rubber, not as breathing. A click adds a
  **decaying oscillation** (squash-and-stretch plus a nod) timed from the click itself,
  gone within 1.6 s.

**What this is not**: true Live2D or Spine skeletal animation. The games' animated
chibi are Spine projects, and *Arknights* uses a **modified Spine 3.8 format** — the
skeletons are 404/403 on the public CDN, and the stock runtime cannot read them anyway
(which is why the community maintains tools like Ark-Models). So there is no
pre-authored skeleton to load; the rig has to be inferred from a still. That is the
honest description of what this is: **it makes a static portrait breathe, shift its
weight and lead with its head the way a standing body does.** It is not a full
character rig, and it has no arm bones — arms overlap the torso in a single flat image,
and driving them independently would tear the artwork.

If any link fails — no WebGL2, a refused context, a shader that will not compile, an
image tainted by cross-origin data — it renders the plain `<img>` instead. So this can
only ever **add** motion, never remove the mascot. The preview script prints
`rig: ON (canvas 140x232)` precisely to keep an eye on that.

### 2. Multi-frame animation

Yuno's Q-version source is **two poses**. `cutout.mjs` runs with `mode: "all"`, keeps
both figures, crops each to its own bounding box, and gives them **one shared scale**
— otherwise the narrower pose would be blown up and she would appear to grow. The
browser cross-fades between them every 5.2 s, which reads as her turning around. It
stands down when the bone rig is on, since two sources of motion would fight.

### 3. Animated files

Any frame that is a GIF or an animated WebP simply plays — the browser handles it.

---

## Usage

| Interaction | Result |
|---|---|
| Click the sprite | Toggle the panel |
| The "角色" row in the panel | Switch character |
| The "形象" row in the panel | Switch that character's look (a "动态" badge marks a multi-frame one) |
| Click the backdrop or press `Esc` | Close the panel |
| The "动效" row in the panel | Toggle the bone rig (shows "本机不可用" when the machine cannot run it) |
| Click "刷新" | Re-read the balance immediately (it also refreshes every 2 minutes while open) |

The choice is stored in localStorage. With the system's "reduce motion" preference
set, every animation is switched off.

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
│   ├── index.js        host half: the /dsh-mascot routes (balance, index, artwork)
│   └── client.js       browser half: sprite, panel, two themes, skinned-mesh renderer
├── art/
│   ├── looks.json      hand-authored declaration: characters, themes, urls, hashes
│   ├── index.json      generated by art-sync: framing, accents, frame lists
│   ├── closure-*.png   ← npm run fetch-art, gitignored
│   └── yuno-*.png      ← ditto; the Q-version sheet is cut out then split
└── scripts/
    ├── fetch-art.mjs   download → cut out → hand off to art-sync
    ├── cutout.mjs      key a background out; split a multi-pose sheet into aligned frames
    ├── art-sync.mjs    measure alpha boxes and accents, write index.json; --watch
    ├── chrome.mjs      Chromium discovery, shared by preview, cutout and art-sync
    ├── check.mjs       self-test: declaration/index agreement, bundle, routes
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
off disk and decide which are installed. So the host half owns one same-origin
route prefix:

```
GET /dsh-mascot/api/balance   account balance, cached
GET /dsh-mascot/api/health    route liveness, for debugging
GET /dsh-mascot/api/looks     which looks are installed, with framing and accents
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
  404, which the browser half turns into the placeholder;
- `/api/looks` re-reads `art/index.json` per request and **drops any look whose
  files are not on disk** — so a fresh clone (index present, images absent)
  answers with nothing and gets the placeholder rather than a broken image.

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
| Available looks | this plugin's `/dsh-mascot/api/looks` | re-reads `art/index.json`, filtered to files on disk |
| Artwork | this plugin's `/dsh-mascot/art/<file>` | `art/` on disk, with the built-in placeholder as fallback |

Anything unmeasurable renders as `—` rather than `0`: with no session there is
no hit rate to report, and the panel does not invent one.

---

## Development

```bash
npm install                # react / react-dom, devDependencies for the preview only
npm run fetch-art          # download → cut out → re-index, in one go
npm run art:sync           # just re-measure and rewrite art/index.json
npm run art:watch          # watch art/ and re-index whenever a file lands
npm test                   # self-test (27 checks)
npm run check              # node --check on both halves plus the self-test
npm run preview            # docs/preview.png — placeholder, committed
npm run preview:official   # docs/preview-official.png — official art, gitignored
npm run verify             # pre-flight the current DSH profile
```

Running the cut-out pass on its own (a multi-pose sheet becomes several frames):

```bash
node scripts/cutout.mjs <sheet.png> <frame1.png> <frame2.png> --mode all
```

**Framing needs no manual numbers.** `npm run art:sync` re-measures and writes
them into the index. To override by hand, edit the `seat` block of a frame in
`art/index.json` and refresh the page.

To add a theme: add a key to `THEMES` in `lib/client.js`, then have a character
name it in `art/looks.json`.

---

## Artwork and licensing

- **Code**: [MIT](LICENSE)
- **Official artwork (`art/*.png`, not committed)**: Closure's *Arknights* official
  Q-version operator sprite and operator art, and Sengoku Yuno's official
  *BanG Dream!* anime art, everyday-clothes art and Q-version design. **The rights
  belong to their respective owners; this is publisher-commissioned art.** This
  repository does not distribute those files; it ships the `art/looks.json`
  declaration and the `npm run fetch-art` script so each user downloads them onto
  their own machine. Fine for personal use — **get permission before
  redistributing or using commercially.** `scripts/cutout.mjs` keys a background
  out of Yuno's Q-version sheet and splits its two poses; that is pixel
  processing and changes no content.
- **Built-in placeholder**: the generic "image missing" glyph in `lib/client.js`
  (a dashed box plus a picture symbol). It depicts no character and is MIT
  alongside the code.
- **Characters**: Closure © Hypergryph (*Arknights*); Sengoku Yuno © Bushiroad
  (*BanG Dream!* / Mugendai MewType). Both are the property of their respective
  owners. This is an unofficial fan work with no affiliation or endorsement.
- **DSH**: DeepSeek Harness and its `@deepseek-ai/*` packages belong to their
  respective authors; this repository only builds against its plugin surface.
