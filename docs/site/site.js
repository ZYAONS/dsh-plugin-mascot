/*
 * dsh-plugin-mascot — configuration console.
 *
 * This page cannot touch the machine it is viewed on, and deliberately does not
 * try: it renders a UI, and everything it produces is a string the visitor copies
 * or downloads. No server, no tracking, no local access.
 *
 * The look catalogue comes from `site/catalog.json`, which
 * `scripts/build-site.mjs` generates from `art/looks.json` — the same declaration
 * the plugin itself reads, so the two cannot drift.
 */

const REPO = "https://github.com/ZYAONS/dsh-plugin-mascot";
const STATE_KEY = "dsh-mascot-console";

/** Which per-character interface style each theme maps to, for the card art. */
const THEME_COLOURS = {
  rhodes: { accent: "#37e0d8", label: "CONSOLE", page: "closure" },
  mewtype: { accent: "#ff4d9d", label: "LIVE SET", page: "yuno" },
};

/** Human names for the page themes, for the header readout. */
const PAGE_THEME_NAMES = { closure: "可露希尔 · 罗德岛工程终端", yuno: "千石由乃 · MEWTYPE LIVE" };

const state = {
  catalog: { characters: [], looks: [], version: "0.0.0", repository: REPO },
  plugin: true,
  character: "closure",
  /** Look ids the visitor turned off, per character. */
  off: new Set(),
  skeleton: true,
  animated: true,
  balance: true,
  mount: "name",
  dir: "",
  /** "auto" follows the selected character; anything else pins one theme. */
  theme: "auto",
};

const $ = (id) => document.getElementById(id);

/** Escape the two characters that could break out of the YAML snippet. */
const yamlString = (value) => `'${String(value).replace(/'/gu, "''")}'`;

/** Look up one character record. */
const characterOf = (id) => state.catalog.characters.find((entry) => entry.id === id);

/** The looks of one character, in declaration order. */
const looksOf = (id) => state.catalog.looks.filter((look) => look.character === id);

/** Whether a look is currently enabled. */
const lookOn = (id) => !state.off.has(id);

/** The looks that survive the visitor's choices; a look is only dropped when every
 * option of a character was switched off, in which case that character keeps all
 * of them rather than becoming unusable. */
function enabledLooks(characterId) {
  const all = looksOf(characterId);
  const on = all.filter((look) => lookOn(look.id));
  return on.length > 0 ? on : all;
}

//#region render
/** The page theme a character's own interface style maps to. */
function pageThemeOf(characterId) {
  const character = characterOf(characterId);
  return THEME_COLOURS[character?.theme]?.page ?? "closure";
}

/** The theme actually applied, resolving "auto" against the selected character. */
const activeTheme = () => (state.theme === "auto" ? pageThemeOf(state.character) : state.theme);

/** Apply the theme to the document and its readout. */
function applyTheme() {
  const theme = activeTheme();
  document.documentElement.dataset.theme = theme;
  $("m-theme").textContent = PAGE_THEME_NAMES[theme] ?? theme;
  for (const button of $("theme").querySelectorAll("button")) {
    button.dataset.on = button.dataset.themeChoice === state.theme ? "1" : "0";
  }
}

/** Persist the console state so a reload keeps the visitor's choices. */
function save() {
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify({
      plugin: state.plugin,
      character: state.character,
      off: [...state.off],
      skeleton: state.skeleton,
      animated: state.animated,
      balance: state.balance,
      mount: state.mount,
      dir: state.dir,
      theme: state.theme,
    }));
  } catch {
    /* private mode — the choices simply do not persist */
  }
}

/** Restore a previous session, tolerating anything unreadable. */
function load() {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (raw === null) return;
    const saved = JSON.parse(raw);
    if (typeof saved.plugin === "boolean") state.plugin = saved.plugin;
    if (typeof saved.character === "string") state.character = saved.character;
    if (Array.isArray(saved.off)) state.off = new Set(saved.off);
    if (typeof saved.skeleton === "boolean") state.skeleton = saved.skeleton;
    if (typeof saved.animated === "boolean") state.animated = saved.animated;
    if (typeof saved.balance === "boolean") state.balance = saved.balance;
    if (saved.mount === "name" || saved.mount === "file") state.mount = saved.mount;
    if (typeof saved.dir === "string") state.dir = saved.dir;
    if (typeof saved.theme === "string") state.theme = saved.theme;
  } catch {
    /* unreadable state is not worth reporting; defaults are fine */
  }
}

/** A Windows or POSIX path as a file: URL, which is what a patch row wants. */
function fileUrl(path) {
  const trimmed = String(path).trim().replace(/[\\/]+$/u, "");
  if (trimmed === "") return "";
  if (/^file:/iu.test(trimmed)) return trimmed;
  if (/^[a-z]:[\\/]/iu.test(trimmed)) return `file:///${trimmed.replace(/\\/gu, "/")}`;
  return `file://${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

/** Render the character cards. */
function renderCharacters() {
  const host = $("characters");
  host.textContent = "";
  for (const character of state.catalog.characters) {
    const theme = THEME_COLOURS[character.theme] ?? { accent: "#ffd400", label: "—" };
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.on = character.id === state.character ? "1" : "0";
    card.tabIndex = 0;
    card.innerHTML = [
      `<span class="check"></span>`,
      `<div class="code">${theme.label} / ${character.id}</div>`,
      `<div class="name">${character.name}</div>`,
      `<div class="latin">${character.latin}</div>`,
      `<div class="role">${character.role}<br>${character.tagline ?? ""}</div>`,
      `<div class="swatch" style="background:${theme.accent}"></div>`,
    ].join("");
    const choose = () => {
      state.character = character.id;
      renderCharacters();
      renderLooks();
      render();
    };
    card.addEventListener("click", choose);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        choose();
      }
    });
    host.append(card);
  }
}

/** Render the look checkboxes for the selected character. */
function renderLooks() {
  const host = $("looks");
  host.textContent = "";
  for (const look of looksOf(state.character)) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.on = lookOn(look.id) ? "1" : "0";
    card.tabIndex = 0;
    card.innerHTML = [
      `<span class="check"></span>`,
      `<div class="code">${look.id}</div>`,
      `<div class="name">${look.name}</div>`,
      look.animated ? `<span class="badge">多帧</span>` : "",
    ].join("");
    const toggle = () => {
      if (lookOn(look.id)) state.off.add(look.id);
      else state.off.delete(look.id);
      renderLooks();
      render();
    };
    card.addEventListener("click", toggle);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
    host.append(card);
  }
}

/** Paint one toggle element from the state. */
function paintToggle(id, on) {
  const node = $(id);
  node.dataset.on = on ? "1" : "0";
  node.setAttribute("aria-checked", on ? "true" : "false");
}

/** The YAML the visitor pastes into their profile. */
function buildConfig() {
  const character = characterOf(state.character);
  const looks = enabledLooks(state.character).map((look) => look.id);
  const lines = [];

  if (!state.plugin) {
    lines.push("# 看板娘插件：已关闭 —— 不插入这一行就是关闭状态。");
    lines.push("# 想重新打开，把下面这段前面的 # 去掉。");
    lines.push("#");
    lines.push("# - insert:");
    lines.push("#     - id: mascot");
    lines.push(`#       name: ${state.mount === "file" ? "file:///…/dsh-plugin-mascot/lib/index.js" : "dsh-plugin-mascot"}`);
    return lines.join("\n");
  }

  lines.push("# DSH profile patch —— 贴进 ~/.dsh/profiles/desktop/cordis.patch.yml");
  lines.push("# 不要写 cordis.yml：它每次启动都会被改写成 []。");
  lines.push("- insert:");
  lines.push("    - id: mascot");
  if (state.mount === "file") {
    const resolved = fileUrl(state.dir);
    lines.push(`      # 绝对路径挂载：本插件零运行时依赖，不需要装进 profile。`);
    lines.push(`      name: ${yamlString(resolved === "" ? "file:///填入/插件目录/lib/index.js" : `${resolved}/lib/index.js`)}`);
  } else {
    lines.push(`      name: dsh-plugin-mascot`);
  }
  lines.push("      config:");
  lines.push(`        # 默认角色：${character === undefined ? state.character : character.name}`);
  lines.push(`        character: ${state.character}`);
  const preferred = enabledLooks(state.character).find((look) => (state.animated ? true : !look.animated)) ?? enabledLooks(state.character)[0];
  lines.push(`        look: ${preferred.id}`);
  lines.push(`        # 允许出现的形象（allowlist）。空列表 = 全部已安装的。`);
  lines.push(`        looks:`);
  for (const id of looks) lines.push(`          - ${id}`);
  lines.push(`        skeleton: ${state.skeleton}`);
  lines.push(`        balance: ${state.balance}`);
  if (!state.animated) {
    lines.push(`        # 多帧形象已在配置台关闭：下面的 allowlist 里只留下了单帧形象。`);
  }
  return lines.join("\n");
}

/** Re-render everything derived from state. */
function render() {
  paintToggle("t-plugin", state.plugin);
  paintToggle("t-balance", state.balance);
  paintToggle("t-skeleton", state.skeleton);
  paintToggle("t-animated", state.animated);
  $("s-plugin").className = state.plugin ? "status" : "status off";
  $("s-plugin").innerHTML = `<i></i>${state.plugin ? "Enabled" : "Disabled"}`;
  $("dir-field").classList.toggle("hidden", state.mount !== "file");
  $("sec-look").classList.toggle("hidden", !state.plugin);
  $("sec-character").classList.toggle("hidden", !state.plugin);
  $("output").textContent = buildConfig();
  // Applied last, and on every render, because "auto" resolves against the
  // character and the character can change in the same pass.
  applyTheme();
  save();
}
//#endregion

//#region events
/** Wire one toggle element to a state setter. */
function bindToggle(id, apply) {
  const node = $(id);
  const flip = () => {
    apply(!node.dataset.on || node.dataset.on !== "1");
    render();
  };
  node.addEventListener("click", flip);
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      flip();
    }
  });
}

/** Copy text, preferring the async clipboard and falling back to a textarea. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** Save a string as a file, entirely client-side. */
function download(name, text) {
  const blob = new Blob([text], { type: "text/yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Show a transient label on a button. */
function flash(button, label) {
  const original = button.textContent;
  button.textContent = label;
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1400);
}
//#endregion

/**
 * Read a deep link.
 *
 * `?theme=` and `?character=` let a link point at a specific configuration —
 * "show me the Yuno version" is a URL — and they are also what makes the two
 * themes testable without driving clicks: a headless render of the page with a
 * query string is enough to assert which theme came out.
 *
 * A query parameter outranks stored state, because a link that says what it wants
 * should not be silently overridden by a previous visit.
 */
function applyQuery() {
  let query;
  try {
    query = new URLSearchParams(window.location.search);
  } catch {
    return;
  }
  const theme = query.get("theme");
  if (theme === "auto" || theme === "closure" || theme === "yuno") state.theme = theme;
  const character = query.get("character");
  if (character !== null && character !== "") state.character = character;
}

/** Boot: fetch the catalogue, wire the controls, draw. */
async function main() {
  load();
  applyQuery();
  try {
    const response = await fetch("site/catalog.json", { cache: "no-cache" });
    if (response.ok) state.catalog = await response.json();
  } catch {
    /* the page still works, just with an empty catalogue */
  }
  const characters = state.catalog.characters ?? [];
  if (characters.length > 0 && !characters.some((entry) => entry.id === state.character)) {
    state.character = characters[0].id;
  }

  $("m-version").textContent = state.catalog.version ?? "—";
  $("m-characters").textContent = String(characters.length);
  $("m-looks").textContent = String((state.catalog.looks ?? []).length);
  $("f-repo").href = state.catalog.repository ?? REPO;
  $("f-readme").href = `${state.catalog.repository ?? REPO}#readme`;
  $("download-repo").href = `${state.catalog.repository ?? REPO}/archive/refs/heads/main.zip`;

  bindToggle("t-plugin", (value) => { state.plugin = value; });
  bindToggle("t-balance", (value) => { state.balance = value; });
  bindToggle("t-skeleton", (value) => { state.skeleton = value; });
  bindToggle("t-animated", (value) => { state.animated = value; });

  for (const button of $("theme").querySelectorAll("button")) {
    button.addEventListener("click", () => {
      state.theme = button.dataset.themeChoice;
      render();
    });
  }

  for (const button of $("mount").querySelectorAll("button")) {
    button.addEventListener("click", () => {
      state.mount = button.dataset.mount;
      for (const peer of $("mount").querySelectorAll("button")) {
        peer.dataset.on = peer === button ? "1" : "0";
      }
      render();
    });
    button.dataset.on = button.dataset.mount === state.mount ? "1" : "0";
  }

  $("dir").addEventListener("input", (event) => {
    state.dir = event.target.value;
    render();
  });
  $("dir").value = state.dir;

  $("copy").addEventListener("click", async () => {
    const ok = await copyText(buildConfig());
    flash($("copy"), ok ? "已复制" : "复制失败");
  });
  $("download-config").addEventListener("click", () => {
    download("cordis.patch.yml", `${buildConfig()}\n`);
    flash($("download-config"), "已下载");
  });

  renderCharacters();
  renderLooks();
  render();
}

main();
