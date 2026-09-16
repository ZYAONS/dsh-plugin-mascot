# dsh-plugin-mascot

English | [中文](README.zh.md)

A clickable mascot for the **DeepSeek Harness** (DSH) Web GUI. It sits quietly in
the bottom-right corner; click it and a panel opens with what the session has
actually cost you and how well the prompt cache is doing.

- **Token cache-hit rate** — cache reads over every billed input bucket
- **Token breakdown** — uncached input / cache read / cache write / output / session total
- **Context occupancy** — current usage against the context window, with a bar
- **Account balance** — fetched host-side from DeepSeek; the API key never reaches the browser
- **Two characters, switchable** — **Closure** from *Arknights* and **Sengoku Yuno** from *BanG Dream!*'s Mugenai MewType

![preview](docs/preview.png)

> The preview is rendered by `node scripts/preview.mjs` from the real browser
> half — opening the panels and switching characters are genuine DOM clicks.
> Only the two inputs a plain page cannot supply (the session projections and
> the balance route) are stubbed.

---

## Contents

- [Install](#install)
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

> Behind a proxy or self-hosted gateway, point `baseUrl` at it — the only
> requirement is that it implements `GET /user/balance`.

---

## How it works

One package, two halves:

```
dsh-plugin-mascot/
├── lib/
│   ├── index.js     host half: the /dsh-mascot route and the balance lookup
│   └── client.js    browser half: sprite + panel (window.__ModuleLoader__ format)
├── assets/
│   ├── closure.svg  Closure artwork (vector source)
│   └── yuno.svg     Sengoku Yuno artwork (vector source)
└── scripts/
    ├── sync-art.mjs inlines assets/*.svg into lib/client.js
    ├── check.mjs    self-test: manifest, bundle load, statistics, artwork
    └── preview.mjs  renders docs/preview.png from the real code in a browser
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
API key, and the key must never leave the host process. So the host half does
exactly one job — a small same-origin JSON route:

```
GET /dsh-mascot/api/balance   account balance, cached
GET /dsh-mascot/api/health    route liveness, for debugging
```

- The key is resolved per request through `ctx.credentials.resolve()`, so a
  **rotated key takes effect on the next call** with no restart;
- it is used only as an `Authorization: Bearer` header and **never** appears in
  a response body, a log line, or an error message;
- the route is gated on `ctx.connection.isAuthenticated(req)` — the same browser
  cookie the rest of the GUI uses. If Connection is absent from the composition
  it falls back to accepting only a loopback `Host` header.

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

Anything unmeasurable renders as `—` rather than `0`: with no session there is
no hit rate to report, and the panel does not invent one.

---

## Development

```bash
npm install          # react / react-dom, devDependencies for the preview only
npm test             # self-test
npm run check        # node --check on both halves plus the self-test
npm run sync-art     # re-inline assets/*.svg into lib/client.js
node scripts/preview.mjs   # re-render docs/preview.png
```

The artwork loop: edit `assets/*.svg` → `npm run sync-art` →
`node scripts/preview.mjs` → restart DSH (or wait for HMR) to see it in the GUI.

---

## Artwork and licensing

- **Code**: [MIT](LICENSE)
- **Artwork**: `assets/closure.svg` and `assets/yuno.svg` are **original vector
  fan art drawn for this repository**, redrawn from each character's publicly
  documented design cues (hair and eye colours, outfit palette, signature props).
  No official asset or third-party image was used, traced, or embedded. They are
  MIT-licensed alongside the code; check the relevant character rights yourself
  before any commercial use.
- **Characters**: Closure © Hypergryph (*Arknights*); Sengoku Yuno © Bushiroad
  (*BanG Dream!* / Mugendai MewType). Both are the property of their respective
  owners. This is an unofficial fan work with no affiliation or endorsement.
- **DSH**: DeepSeek Harness and its `@deepseek-ai/*` packages belong to their
  respective authors; this repository only builds against its plugin surface.
