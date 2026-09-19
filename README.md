# dsh-plugin-mascot

English | [中文](README.zh.md)

A clickable mascot for the **DeepSeek Harness** (DSH) Web GUI. It sits quietly in
the bottom-right corner; click it and a panel opens with what the session has
actually cost you and how well the prompt cache is doing.

- **Token cache-hit rate** — cache reads over every billed input bucket
- **Token breakdown** — uncached input / cache read / cache write / output / session total
- **Context occupancy** — current usage against the context window, with a bar
- **Account balance** — fetched host-side from DeepSeek; the API key never reaches the browser
- **Three characters, seven official looks, switchable** — Closure and Muelsyse (*Arknights*), Sengoku Yuno (*BanG Dream!*)
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

## Copyright

**This repository contains no artwork belonging to anyone else.** The characters are
© their owners — Closure and Muelsyse © Hypergryph (*Arknights*), Sengoku Yuno © Bushiroad
(*BanG Dream!* / Mugendai MewType) — and `npm run fetch-art` downloads the images onto
each machine rather than shipping them. Bushiroad's terms permit individual,
non-commercial derivative works and prohibit copying the content without adding
creativity, which is why the artwork is never committed and the characters are shown
from their original sources instead.

Read **[COPYRIGHT.md](COPYRIGHT.md)** for the full position, including what is MIT,
what is not, and the test that fails if artwork is ever tracked by git.

## Web console

Decide how this plugin is mounted and which character it wears **in a browser**,
before anything is installed on the machine:

**https://zyaons.github.io/dsh-plugin-mascot/**

![console](docs/site/preview.png)

- **00 Live preview** — shows the mascot animated, wearing whichever look you picked;
  click a look card to put it in the frame. **Show the skeleton** draws the rig
  itself — the three bones with their joints, the deformation mesh and the figure's
  outline — for any look, on either copy, because it needs only the measured numbers
  and never an image.
- **01 Plugin** — the plugin itself on/off, and the balance lookup on/off
- **02 Character** — Closure (Rhodes Island console), Sengoku Yuno (MEWTYPE LIVE) or Muelsyse (Rhine Lab ecology)
- **03 Looks** — tick which artwork may appear; an unticked look goes into an
  allowlist, so the plugin will not even list it
- **04 Motion** — the bone rig, and multi-frame looks
- **05 Output** — a ready-to-paste `cordis.patch.yml`, with copy and download
- **06 Install** — five steps, including fetching the artwork and restarting

### Where the artwork comes from

The console renders the mascot on **both** copies, from three places in order of
preference:

1. **A copy you published** into `docs/art/` with `npm run art:publish`. Same origin
   as the page, so the rig always works and nothing depends on anyone else's server.
   *Not committed by default* — see below.
2. **The declared source**, loaded with CORS. The rig accepts it, so it animates.
3. **The declared source, loaded plainly.** It displays, but a cross-origin image
   without a CORS header taints the canvas and WebGL refuses it, so it cannot be
   deformed. It can still cycle between drawn poses.

Which of 2 and 3 applies is a fact about each host, measured once and recorded in
`art/looks.json` as `cors`. Today: Closure's base sprite is served by
raw.githubusercontent and jsDelivr, both of which send `Access-Control-Allow-Origin`,
so it **rigs and animates on the published page**, as does Muelsyse's base sprite, which
comes from the same repository; the moegirl-hosted looks (both portraits and all three
of Yuno's) send no such header, so they **display but do not
deform**. The page says which case it is in the status line rather than leaving you
to guess why one of them is still.

Served by the plugin at `/dsh-mascot/console/` there is a fourth source — the artwork
on your own machine — and there everything rigs, because it is all same-origin.

### When the pixels cannot be touched, they can still be composed

Case 3 above is the interesting one: a cross-origin image with no CORS header cannot
be uploaded as a texture, so no vertex of it can be deformed. It can still be
*decomposed*. `index.json` already records where each figure's neck pinches and where
its hip sits, so the console stacks **two masked copies of the same image** — the head
above, the body below — and rotates each about its own joint. The head copy is a child
of the body's transform, so it inherits the sway and adds its own nod on top, the same
parent-then-child order the bone chain uses. The join is feathered across the neck
rather than cut, so a small angle reads as a head moving rather than as two pictures
sliding past each other.

Two rigid layers, no skinning — nothing bends. That is the honest description of what
can be done with an image whose pixels are off-limits, and it is what puts **all five
looks in motion on the published page**, not just the one whose host sends CORS.

It also needed one piece of geometry that did not exist before. Yuno's Q-version is
two drawn poses **cut out of a single 645×645 download**, and the published page
hotlinks that download — so the measured silhouette was being applied to an image
containing both figures, and the head was being masked in the wrong place. `cutout.mjs`
now keeps the crop rectangle it already computed, `fetch-art` records it in
`art/crops.json`, and the console maps the measurements through it. A local copy is
already cropped, so the rectangle is applied only to a fetched image.

### Publishing the artwork (opt in)

```bash
npm run art:publish     # copies art/*.png into docs/art/
npm run build:site      # records which frames are now local
git add -f docs/art     # this is the deliberate step
```

`docs/art/` is gitignored, so it cannot be committed by accident. Committing it means
**this repository redistributes official game artwork** — Closure © Hypergryph, from
*Arknights*; Sengoku Yuno © Bushiroad, from *BanG Dream!* / Mugendai MewType — and
GitHub Pages serves it publicly. That is a rights decision, which is why the project
does not make it for you and why the script prints the warning before it copies
anything.

`build-site` only advertises a local copy once it is actually **tracked by git**, so a
catalogue can never promise files a deployment does not have. Build with the artwork
present but uncommitted and the page correctly falls back to the sources.
### Four page themes, one per character plus a neutral

The console carries an interface style for each character, and they are not hue swaps:

| | Neutral (`auto`) | Closure | Yuno | Muelsyse |
|---|---|---|---|---|
| Ground | neutral charcoal | blue-black | purple-black | dark green |
| Signal | silver | blue | magenta | light green |
| Corners | square | square | 14px rounded | 10px rounded |
| Selection cue | brackets | corner brackets | a glow | an inset ring |
| Labels | monospace | monospace | rounded | sans |

**A character's theme selects that character.** Choosing Yuno's theme switches the
artwork to Yuno, and choosing Yuno switches the theme to hers — whichever control you
use, the two move together, because a page showing one character in another's colours
is a page contradicting itself. The neutral theme is the exception that proves the
rule: it belongs to no character, so it can be chosen without disturbing who is on
screen, and it is the only one permitted to disagree with the artwork.

Both are deep-linkable, and `?theme=` moves the character too:

```
?theme=auto|closure|yuno|muelsyse      ?character=closure|yuno|muelsyse
```
### Language

The console is **English**; the plugin's own panel is Chinese. The split is
deliberate — the console is what strangers see first, the panel is what the operator
reads every day — and the names that need both live in one place: `art/looks.json`
carries `nameEn` / `roleEn` / `taglineEn` next to the plugin's `name` / `role` /
`tagline`, and `build-site.mjs` copies the English set into the console's catalogue.
Adding a look to the plugin gets it an English name by editing one file, and
`check-site` fails if a record it renders has no translation, or if Chinese text
reappears in the page outside the rights notice.

The page is **purely static**, hosted on GitHub Pages. It runs no server code and
**does not read or modify anything on your machine** — it turns your choices into a
YAML string. State lives in your browser's localStorage.

The palette and typography borrow from tactical-UI design generally (near-black
ground, one signal colour, hairline rules, uppercase Latin labels). **No game asset,
logo or typeface is used.**

Its catalogue comes from `docs/site/catalog.json` and its skeleton from
`docs/site/rig.js` — **both generated by `scripts/build-site.mjs` from the plugin's
own sources**, so neither can drift from what the plugin actually does. `rig.js` is
lifted region-by-region out of `lib/client.js`; the plugin's browser half has to be
one file (the module loader takes one registration per package), and copying the
geometry by hand would have been a second implementation waiting to disagree.

### How the console is checked

`scripts/check-site.mjs` drives the page over the **Chrome DevTools Protocol** — a
real browser, real dispatched clicks, real console output — because the console is
the one artefact here that cannot be unit-tested by importing it. The rule its
assertions follow is that a claim has to be a fact produced by *running* the page,
not an inference from reading its source:

- **It really moves.** The page claims the sprite is animated, so the suite captures
  the preview region twice from the compositor and requires the bytes to differ.
  Nothing that merely exists can satisfy that.
- **The WebGL path really ran.** A canvas only appears when the shaders compiled and
  a texture uploaded; the graceful fallback produces a still `<img>` and no canvas,
  so the presence of a correctly-backed canvas is evidence rather than decoration.
- **Clicks are dispatched, not simulated.** `Input.dispatchMouseEvent` at the
  element's centre, after scrolling it into view — a click whose coordinates fall
  outside the viewport lands on nothing, which would fail as though the handler were
  broken.
- **Console errors are failures.** `Runtime.exceptionThrown`, `Log.entryAdded` at
  error level and `console.error` all count.
- **Two viewports, one of them genuinely narrow.** 390px is set through
  `Emulation.setDeviceMetricsOverride`, not `--window-size`: a headless window has a
  minimum width that crops a wider layout, which turns "text overflows" into a
  phantom bug. The suite asserts the viewport really is 390px before trusting the
  overflow result.
- **Both `file://` and a deployed URL.** `npm run check:site -- https://…/` runs the
  same assertions against the live site.

46 checks, plus 28 for the plugin.

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

### 1a. Where the idle's numbers come from

Not from taste. Arknights ships its base chibi as **Spine 3.8 models**, and they are
readable — [Ark-Models](https://github.com/isHarryh/Ark-Models) mirrors them and the
official 3.8 runtime parses them:

```bash
npm run rig:reference            # Closure's base chibi, its Relax animation
```

```
Relax: 8.00 s, 240 samples
  hip  (F_Waist_I)   ±0.19°  2.00 s
  head (F_Head_I)    ±0.51°  2.00 s
```

That last column is the one that mattered. The rig used to nod **±2.4° over eight
seconds** — several times too far and four times too slow, which is why it read as a
slow lean rather than as breathing. It now runs on the measured 2.00 s beat.

The degrees are *not* copied: the game rigs 297 bones and this rigs three, so an angle
does not mean the same thing in both. The period does, and the order of magnitude does.

Neither the runtime nor the model is committed — both land in `.cache/spine`, which is
ignored, because the runtime is Spine's under the Spine Runtimes License and the models
are Hypergryph's. The extractor fetches one `.skel` rather than the repo's ~1 GB, and
skips the texture atlas entirely: it hands the reader the real attachment classes with
a dummy texture region, which satisfies its bookkeeping without an image.

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

The pill under the sprite shows three figures, and only the ones that can be measured:

| | Where it comes from |
| --- | --- |
| **余额** `¥128.42` | the host asks DeepSeek; the API key never reaches the browser |
| **命中** `89.0%` | this session's cache hit rate (cache reads / billed input) |
| **今天** `1.2M` | Tokens spent today, on this machine |

If the balance lookup fails it reads "点我 Token / 余额" instead of pretending to know.

**Why "today" needs the host to keep books.** The browser knows what *this session* spent —
the session projection says so. Nothing knows what the *day* spent: a session that ended an
hour ago took its numbers with it, and the next one starts at zero. So the host keeps a
daily ledger (`.cache/usage-daily.json`, gitignored).

The rule is **high-water mark per session, difference added to the day**. The browser reports
a cumulative session total, repeatedly, so re-reporting the same number has to add nothing —
otherwise a panel polling every two seconds would inflate the day at its own polling rate,
and the number would still look like a measurement. A total that goes backwards (a reused id,
a reset projection) never subtracts; the mark simply holds. Crossing midnight resets it:
yesterday's numbers are not today's.

---

## The room behind each character

Every character stands somewhere. **No backdrop image is in this repository** — it is either
a room the plugin draws from gradients, or official furniture art you downloaded yourself.

The drawn room is per character (Closure gets her own workshop: dark blue room, an L-shaped
white desk, two screens, the cyan strip light under it, posters on the wall, the tentacle-print
rug on the floor). To use the real furniture art instead:

```
npm run fetch-rooms            # download what is missing
npm run fetch-rooms -- --list  # show the declaration, download nothing
npm run fetch-rooms -- --force # re-download
```

Images land in `art/room-<character id>.<png|jpg|webp>`. The host finds them by name
(`readRooms`), so a restart is all it takes — there is no index to rebuild. The declaration
is `art/rooms.json`: which set, whether it is the operator's own set or a thematic match, and
the source page.

**This is official Hypergryph artwork — do not commit it.** `art/` is gitignored and
`npm test` fails if any image is tracked by git, backdrops included. Deleting `art/room-*`
returns the character to the drawn room.

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
