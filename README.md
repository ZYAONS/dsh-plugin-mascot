# dsh-plugin-mascot

English | [中文](README.zh.md)

A mascot for the **DeepSeek Harness** (DSH) Web GUI. It sits in the bottom-right corner. Click it and a panel opens with the session's token cost and cache performance.

![preview](docs/preview.png)

The image above is `lib/client.js` running in Chromium with the built-in placeholder, i.e. a fresh clone before `npm run fetch-art`. With the official artwork installed it looks like `docs/preview-official.png`, which is generated locally and not committed.

## What the panel shows

| | |
|---|---|
| Token cache-hit rate | cache reads over all billed input |
| Token breakdown | uncached input, cache read, cache write, output, session total |
| Context occupancy | current usage against the context window |
| Account balance | fetched host-side; the API key stays in the host process |
| Music | the character's Siren Records album, or a 30-second official preview |
| Character and look | 9 characters, 22 looks |

## Install

DSH Desktop loads plugins through the profile's `cordis.patch.yml`. `cordis.yml` is rewritten to `[]` on every boot; do not edit it.

The plugin has no runtime dependencies. Two ways in, pick one.

**A — point at the file directly.**

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: mascot
      name: 'file:///C:/Users/<you>/Desktop/kexier/dsh-plugin-mascot/lib/index.js'
```

The `file:` URL names a file, not the folder. A relative path also works and resolves against the patch file's directory.

**B — install it as a profile dependency.**

```bash
dsh plugin --profile desktop add "/absolute/path/to/dsh-plugin-mascot"
dsh plugin --profile desktop add link:/absolute/path/to/dsh-plugin-mascot
dsh plugin --profile desktop add "github:ZYAONS/dsh-plugin-mascot"
```

```yaml
- insert:
    - id: mascot
      name: dsh-plugin-mascot
```

Add `config` to either form:

```yaml
- insert:
    - id: mascot
      name: dsh-plugin-mascot
      config:
        baseUrl: 'https://api.deepseek.com'
        cacheTtlMs: 30000
```

**Restart DSH Desktop.** The desktop composes its patch layers once per launch and does not watch the profile directory. Reloading the page is not enough. After the first mount, edits to `lib/client.js` hot-reload without another restart.

## Console

Configure the plugin in a browser before installing anything:

**https://zyaons.github.io/dsh-plugin-mascot/**

| Section | |
|---|---|
| 00 Live preview | the mascot, animated, wearing the look you picked |
| 01 Plugin | plugin on/off, balance lookup on/off |
| 02 Character | one card per character |
| 03 Looks | tick which artwork may appear |
| 04 Motion | bone rig, multi-frame looks |
| 05 Output | a `cordis.patch.yml` to copy or download |
| 06 Install | five steps, including fetching artwork and restarting |

The page is static, runs on GitHub Pages, and reads nothing from your machine. State lives in localStorage. `?theme=` and `?character=` deep-link both, and `?theme=` also selects the character.

Served by the plugin at `/dsh-mascot/console/` it also reads the artwork on your own machine.

### Themes

10 page themes: a neutral one plus one per character.

| | Neutral | Closure | Yuno | Muelsyse | Sakiko | Miuyin | Yuyuan | Dusk | Makoto | Wang |
|---|---|---|---|---|---|---|---|---|---|---|
| Signal | silver | blue | magenta | light green | violet | deep green | cyan | teal | P3R blue | bone |
| Corners | square | square | 14px | 10px | 8px | 14px | 10px | 10px | square | square |

Picking a character's theme selects that character, and picking a character selects its theme. The neutral theme belongs to no character; it is the only one that can disagree with the artwork, and it hides the music row.

### Language

The console is English. The panel is Chinese. `art/looks.json` carries `nameEn` / `roleEn` / `taglineEn` beside `name` / `role` / `tagline`, and `build-site.mjs` copies the English set into the catalogue. `check-site` fails if a rendered record has no translation, or if Chinese reappears outside the rights notice.

## Characters and looks

All artwork belongs to Hypergryph or Bushiroad. The repository ships the declaration, not the images.

```bash
npm run fetch-art              # download, cut out where needed, re-index
npm run fetch-art -- --force   # re-download regardless of hash
```

| Character | Looks | Source |
|---|---|---|
| 可露希尔 Closure | chibi, portrait | *Arknights* |
| 千石由乃 Yuno | chibi (2 poses), anime, casual | *BanG Dream!* |
| 缪尔赛思 Muelsyse | chibi, alt, portrait | *Arknights* |
| 丰川祥子 Sakiko | anime, casual, chibi | *BanG Dream!* × *Arknights* |
| 谬因 Miuyin | chibi, portrait | *Arknights* |
| 予愿安洁莉娜 Yuyuan | chibi, portrait | *Arknights* |
| 夕 Dusk | chibi, portrait | *Arknights* |
| 结城理 Makoto | portrait, chibi, P3R | *Arknights* × *Persona 3 Reload* |
| 望 Wang | chibi, portrait | *Arknights* |

`art/looks.json` is hand-written. `art/index.json` is generated. Every entry carries source URLs and a sha256, checked on download.

To add a look, add an entry to `looks` in `art/looks.json` and run `npm run fetch-art`. No code changes.

`scripts/art-sync.mjs` measures each image's alpha bounding box in a browser, derives the framing for both seats (104×172 sprite, 38×50 portrait), and samples an accent colour. The results go into `art/index.json`, which the host half filters to what is on disk and serves to the browser.

`npm run art:watch` re-indexes whenever a file lands in `art/`.

A missing file falls back to a neutral placeholder — a dashed box with a generic glyph. It depicts no character.

## Motion

Three layers. The first two are motion; the third is the browser playing a file.

### Skeletal animation

A 2D bone and skinned-mesh renderer in WebGL2.

- `art-sync` measures each image's silhouette profile as 32 horizontal bands. The client finds the neck from the band where the silhouette pinches.
- Seven bones: `root` at the feet, `spine` at the hip, `neck` at the neck, `armL`/`armR` at the shoulders, `foreL`/`foreR` at the elbows. Children inherit parent transforms.
- Vertex weights are distributed vertically, blended across a band at each joint. The arms are separate regions, masked to their own side of the centre line.
- The texture is uploaded with `UNPACK_PREMULTIPLY_ALPHA_WEBGL`.
- A click adds a decaying oscillation that ends within 1.6 s.

If WebGL2 is unavailable, a shader fails to compile, or the image taints the canvas, it renders a plain `<img>`. The rig can only add motion. The preview script prints `rig: ON (canvas 140x232)` to report which path ran.

### Measured motion

The idle, greeting and walk come from the games' own Spine models, mirrored by [Ark-Models](https://github.com/isHarryh/Ark-Models) and read with the official 3.8 runtime.

```bash
npm run measure:motion                            # all six animations
npm run measure:motion -- --model=4228_closur --character=closure
npm run measure:motion -- --model=4228_closur --moves
```

Arknights chibi have six animations: `Default`, `Interact`, `Move`, `Relax`, `Sit`, `Sleep`. All six are measured for all 8 characters that have a model; `art/motion.json` is keyed by character. Three are used:

| Animation | Used as | Extent |
|---|---|---|
| `Relax` | idle | waist 0.4°, forearm 28.6° |
| `Interact` | greeting | waist 17.6°, forearm 79.5° |
| `Move` | walk-in on look change | IK feet ±89 units |

`Sit` and `Sleep` carry almost no motion in either channel — `Sleep` moves three bones by at most 2.2 units, `Sit`'s largest translation is an eyeball, and `Default` is a zero-length animation. They are measured and not inlined.

```bash
npm run motion:literal    # regenerate the inlined block in lib/client.js
```

The generated block ships `idle`, `greet`, `move` and the blink per character. A character with no entry falls back to the default.

A character that declares `gesture: "evoker"` raises its right arm to its temple on click: the upper arm turns 140°, the forearm folds 120°.

### Multi-frame animation

Yuno's Q-version is two drawn poses in one sheet. `cutout.mjs` splits them, crops each to its own bounding box, and gives both one shared scale. The browser cross-fades every 5.2 s. It stands down when the bone rig is on.

Any frame that is a GIF or animated WebP plays on its own.

## Music

The panel plays the character's Siren Records album through a hotlinked official CDN. `art/siren.json` maps a character to the album for the event they came from; `art/songs.json` covers characters with a 30-second Apple Music preview and no Siren release.

```bash
npm run siren:sync            # re-resolve albums and previews
npm run siren:sync -- --list
```

No audio file is stored. The host serves both maps through `/api/looks`.

## Rooms

Each character's dock has a backdrop: a room the plugin draws from gradients, or official furniture art.

```bash
npm run fetch-rooms            # download what is missing
npm run fetch-rooms -- --list  # show the declaration
npm run fetch-rooms -- --force # re-download
```

Images go to `art/room-<character id>.<ext>`. The host finds them by filename, so a restart is all that is needed. `art/rooms.json` declares which set each one is and where it came from. Deleting `art/room-*` returns the character to the drawn room.

## Usage

| Interaction | Result |
|---|---|
| Click the sprite | toggle the panel |
| 角色 row | switch character |
| 形象 row | switch look (a 动态 badge marks a multi-frame one) |
| 动效 row | toggle the bone rig |
| Music row ▶ | play or stop |
| Click the backdrop or press Esc | close the panel |
| 刷新 | re-read the balance |

The choice is stored in localStorage. With the system's reduce-motion preference set, all animation stops.

The pill under the sprite shows three figures:

| | Source |
|---|---|
| 余额 `¥128.42` | the host asks DeepSeek; failures read 点我 Token / 余额 |
| 命中 `89.0%` | this session's cache hit rate |
| 今天 `1.2M` | tokens spent today on this machine |

The daily figure needs the host to keep books: a session that ended an hour ago takes its numbers with it. The host keeps `.cache/usage-daily.json`, keyed by session, and stores a high-water mark per session. The browser reports a cumulative total repeatedly, so re-reporting adds nothing; a total that goes backwards never subtracts. Midnight resets it.

## Configuration

Every field has a default.

| Field | Default | Meaning |
|---|---|---|
| `routePrefix` | `/dsh-mascot` | path prefix claimed on the host webserver |
| `baseUrl` | `https://api.deepseek.com` | provider origin hosting the balance endpoint |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | credentials reference in `~/.dsh/.credentials.yaml` |
| `cacheTtlMs` | `60000` | freshness of a balance answer; failures are never cached |
| `timeoutMs` | `10000` | upstream request budget |
| `artDir` | the plugin's own `art/` | directory holding the artwork |

Behind a proxy or self-hosted gateway, point `baseUrl` at it. It must implement `GET /user/balance`.

## Layout

```
dsh-plugin-mascot/
├── lib/
│   ├── index.js        host half: the /dsh-mascot routes
│   └── client.js       browser half: sprite, panel, themes, renderer, music
├── art/
│   ├── looks.json      characters, themes, urls, hashes
│   ├── index.json      generated by art-sync
│   ├── motion.json     generated by measure-motion, keyed by character
│   ├── eyes.json       blink boxes and the blinks' ramp
│   ├── rooms.json      backdrop declarations
│   ├── siren.json      character to Siren Records album
│   └── songs.json      character to official preview
└── scripts/
    ├── fetch-art.mjs       download, cut out, hand off to art-sync
    ├── cutout.mjs          key out a background; split a multi-pose sheet
    ├── art-sync.mjs        measure boxes and accents, write index.json; --watch
    ├── measure-motion.mjs  read a Spine model's animations
    ├── motion-literal.mjs  inline the measured curves into lib/client.js
    ├── siren-sync.mjs      resolve albums and previews
    ├── fetch-rooms.mjs     download backdrops
    ├── chrome.mjs          Chromium discovery, shared by the browser scripts
    ├── check.mjs           the plugin's self-test
    ├── check-site.mjs      drives the console over CDP
    ├── build-site.mjs      generate the console's catalogue and rig
    ├── preview.mjs         render docs/preview*.png from the real code
    └── verify-profile.mjs  pre-flight a live DSH profile
```

## How it works

The DSH GUI is a slot registry. This plugin registers one entry:

**`shell.overlay`** — a frame-wide floating layer above every column and outside their scroll containers. It is a `list` slot, so `id: "mascot"` adds an entry. The layer is click-through; the sprite opts back into pointer events.

`shell.overlay` is `root`-scoped and does not receive `useProjection`, so the entry declares a `session-maybe`-scoped child slot (`mascot.panel`) and renders the panel through `props.renderSlot`. The renderer then supplies `useProjection` / `useSession` / `sessionId`.

The host half owns one same-origin route prefix:

```
GET /dsh-mascot/api/balance   account balance, cached
GET /dsh-mascot/api/health    route liveness
GET /dsh-mascot/api/looks     installed looks, rooms, motion, music
GET /dsh-mascot/art/<file>    artwork from the plugin's art/ directory
```

- The key is resolved per request through `ctx.credentials.resolve()`, used only as an `Authorization: Bearer` header, and never appears in a response body, log line or error message.
- Routes are gated on `ctx.connection.isAuthenticated(req)`. Without Connection in the composition they accept only a loopback `Host` header.
- The artwork route checks path containment, then the extension, then the disk. A missing file is a 404.
- `/api/looks` re-reads `art/index.json` per request and drops any look whose files are not on disk.

## Where the numbers come from

| Shown | Source | Shape |
|---|---|---|
| Token breakdown | `useProjection("tokenUsage")` | `{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }` |
| Cache-hit rate | derived | `cacheReadTokens ÷ (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)` |
| Context occupancy | `useProjection("contextPressure")` | `{ contextWindow?, pressureTokens?, projectedTokens? }` |
| Account balance | `/dsh-mascot/api/balance` | `GET {baseUrl}/user/balance` |
| Looks, rooms, music | `/dsh-mascot/api/looks` | `art/index.json`, filtered to files on disk |

Anything unmeasurable renders as `—`, not `0`.

## Development

```bash
npm install
npm test                  # 47 checks
npm run check             # node --check on both halves, plus the self-test
npm run check:site        # 102 checks, drives the console over CDP
npm run check:site -- https://zyaons.github.io/dsh-plugin-mascot/
npm run build:site        # regenerate docs/site/catalog.json and rig.js
npm run preview           # docs/preview.png — placeholder, committed
npm run preview:official  # docs/preview-official.png — official art, gitignored
npm run verify            # pre-flight the current DSH profile
```

Run `npm run build:site` after editing `lib/client.js`; `check:site` fails if `docs/site/rig.js` is out of step with the plugin's own skeleton.

`npm test` fails if any image under `art/` or `docs/art/` is tracked by git.

`check-site.mjs` drives the page over the Chrome DevTools Protocol: clicks are dispatched with `Input.dispatchMouseEvent`, console errors count as failures, and both `file://` and a deployed URL can be checked. The narrow viewport is set through `Emulation.setDeviceMetricsOverride` rather than `--window-size`, because a headless window has a minimum width that crops a wider layout.

To add a theme: add a key to `THEMES` in `lib/client.js`, add the character's `theme` in `art/looks.json`, then add the page theme in all four places — a button in `docs/index.html`, `THEME_COLOURS` and `PAGE_THEME_NAMES` in `docs/site/site.js`, and a `[data-theme="…"]` rule in `docs/site/site.css`. `check:site` fails if any of the four is missing.

## Copyright

The repository contains no artwork belonging to anyone else. Characters are © their owners — Hypergryph (*Arknights*) and Bushiroad (*BanG Dream!*). `npm run fetch-art` downloads the images onto each machine.

- **Code**: [MIT](LICENSE)
- **Official artwork** (`art/*.png`, not committed): Closure, Muelsyse, Miuyin, Yuyuan, Dusk, Makoto and Wang © Hypergryph; Sengoku Yuno and Sakiko © Bushiroad. Not distributed here. Fine for personal use; get permission before redistributing or using commercially.
- **Placeholder**: the generic glyph in `lib/client.js` depicts no character and is MIT.
- **DSH**: DeepSeek Harness and its `@deepseek-ai/*` packages belong to their respective authors.

Unofficial fan work, not affiliated with or endorsed by any rights holder.

See [COPYRIGHT.md](COPYRIGHT.md).
