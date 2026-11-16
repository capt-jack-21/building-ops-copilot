"use strict";

// Command palette (Ctrl+K or "/"). It only uses the public page: fills the message box and submits the form.
(function () {
  const input = document.querySelector("#input");
  const form = document.querySelector("#composer");
  const sendBtn = document.querySelector("#send");
  const newChat = document.querySelector("#new-chat");

  const PROMPTS = [
    "Any active alarms?",
    "Show chiller 2 power for the last 24 hours",
    "Why did chiller 2 trip overnight?",
    "Is the generator fuel low in Coimbatore?",
    "Create a critical ticket for the chiller trip",
  ];

  const state = { items: [], shown: [], active: 0, assets: [], assetsAt: 0 };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const isRunning = () => sendBtn.textContent.trim() === "Stop";

  function ask(text) {
    if (isRunning()) return;
    input.value = text;
    input.dispatchEvent(new Event("input"));
    form.requestSubmit();
  }

  function setAllTools(open) {
    for (const d of document.querySelectorAll("details.tool")) d.open = open;
  }

  function applyCalm(on) {
    document.body.classList.toggle("calm", on);
    try {
      localStorage.setItem("bops.calm", on ? "1" : "0");
    } catch {
      /* storage may be unavailable; the setting then lasts for this page only */
    }
  }
  try {
    if (localStorage.getItem("bops.calm") === "1") applyCalm(true);
  } catch {
    /* ignore */
  }

  function baseItems() {
    const calm = document.body.classList.contains("calm");
    return [
      ...PROMPTS.map((p) => ({ group: "Ask", label: p, hint: "send", run: () => ask(p) })),
      { group: "Session", label: "New session", hint: "clear the chat", run: () => newChat.click() },
      { group: "Session", label: "Focus the message box", hint: "", run: () => input.focus() },
      { group: "View", label: "Expand all tool cards", hint: "", run: () => setAllTools(true) },
      { group: "View", label: "Collapse all tool cards", hint: "", run: () => setAllTools(false) },
      {
        group: "View",
        label: calm ? "Calm mode: turn off" : "Calm mode: reduce glow and motion",
        hint: "",
        run: () => applyCalm(!calm),
      },
    ];
  }

  function assetItems() {
    return state.assets.map(({ b, a }) => ({
      group: "Inspect equipment",
      label: `${a.name} · ${b.name}`,
      hint: a.status === "ok" ? "" : a.status,
      run: () => ask(`Tell me about ${a.name} in ${b.name} (${a.id}). Check its recent alarms and readings.`),
    }));
  }

  async function loadAssets() {
    if (Date.now() - state.assetsAt < 20000) return;
    try {
      const res = await fetch("/api/twin");
      if (!res.ok) return;
      const snapshot = await res.json();
      state.assets = snapshot.buildings.flatMap((b) => b.assets.map((a) => ({ b, a })));
      state.assetsAt = Date.now();
    } catch (err) {
      console.warn("palette: twin unavailable", err);
    }
  }

  const overlay = el("div", "pal-overlay");
  overlay.hidden = true;
  const box = el("div", "pal-box");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Command palette");
  const query = el("input", "pal-input");
  query.type = "text";
  query.placeholder = "Type a command or pick something to ask...";
  query.setAttribute("aria-label", "Search commands");
  query.autocomplete = "off";
  query.spellcheck = false;
  const list = el("ul", "pal-list");
  list.setAttribute("role", "listbox");
  box.append(query, list, el("div", "pal-foot", "Enter to run  ·  Up and Down to move  ·  Esc to close"));
  overlay.append(box);
  document.body.append(overlay);

  function render() {
    list.textContent = "";
    let lastGroup = "";
    state.shown.forEach((item, i) => {
      if (item.group !== lastGroup) {
        list.append(el("li", "pal-group", item.group));
        lastGroup = item.group;
      }
      const li = el("li", "pal-item");
      li.setAttribute("role", "option");
      li.append(el("span", "pal-label", item.label));
      if (item.hint) li.append(el("span", "pal-hint", item.hint));
      li.addEventListener("mousemove", () => {
        if (state.active !== i) {
          state.active = i;
          markActive();
        }
      });
      li.addEventListener("click", () => run(item));
      list.append(li);
    });
    if (state.shown.length === 0) list.append(el("li", "pal-empty", "No matching commands"));
    markActive();
  }

  function markActive() {
    const nodes = list.querySelectorAll(".pal-item");
    nodes.forEach((node, i) => {
      node.classList.toggle("active", i === state.active);
      node.setAttribute("aria-selected", String(i === state.active));
      if (i === state.active) node.scrollIntoView({ block: "nearest" });
    });
  }

  function filter(keepSelection) {
    const tokens = query.value.toLowerCase().split(/\s+/).filter(Boolean);
    state.shown = state.items.filter((item) => {
      const hay = (item.group + " " + item.label).toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
    if (!keepSelection || state.active >= state.shown.length) state.active = 0;
    render();
  }

  function open() {
    state.items = [...baseItems(), ...assetItems()];
    query.value = "";
    state.active = 0;
    overlay.hidden = false;
    filter(false);
    query.focus();
    loadAssets().then(() => {
      if (overlay.hidden) return;
      state.items = [...baseItems(), ...assetItems()];
      filter(true);
    });
  }

  function close() {
    overlay.hidden = true;
    input.focus();
  }

  function run(item) {
    close();
    setTimeout(() => item.run(), 0);
  }

  query.addEventListener("input", () => filter(false));
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

  document.addEventListener("keydown", (event) => {
    const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement && document.activeElement.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (overlay.hidden) open();
      else close();
      return;
    }
    if (overlay.hidden) {
      if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        open();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (state.shown.length) state.active = (state.active + 1) % state.shown.length;
      markActive();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (state.shown.length) state.active = (state.active - 1 + state.shown.length) % state.shown.length;
      markActive();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = state.shown[state.active];
      if (item) run(item);
    } else if (event.key === "Tab") {
      event.preventDefault();
    }
  });

  const hint = el("button", "kbd-hint", "Ctrl K");
  hint.type = "button";
  hint.title = "Open the command palette";
  hint.addEventListener("click", open);
  const right = document.querySelector(".top-right");
  if (right) right.prepend(hint);
})();
