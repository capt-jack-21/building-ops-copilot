"use strict";

// Building twin: an SVG schematic per building, fed by GET /api/twin.
// Tool events from the agent pulse the equipment being inspected.
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const host = document.querySelector("#twin");
  const chatInput = document.querySelector("#input");

  const W = 260, TILE_W = 72, TILE_H = 42, GAP = 6, X0 = 16, Y0 = 36, ROW_H = 60;
  const SLOTS = { ahu: [[0, 0]], energy_meter: [[1, 0]], fuel_tank: [[1, 1]], chiller: [[2, 0], [2, 1]], pump: [[2, 2]] };
  const ROW_LABELS = ["ROOF", "SERVICES", "PLANT"];
  const STATUS_LABEL = { ok: "all clear", recovered: "recovered", info: "info", warning: "warning", critical: "critical" };
  const UNIT = { degC: "\u00b0C" };

  const state = { meters: {}, buildings: [], tiles: new Map(), frames: new Map() };
  const pulses = new Map(); // id -> number of tool calls currently inspecting it
  const callTargets = new Map(); // tool call id -> { ids, started }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function snode(tag, attrs, cls, text) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
    if (cls) n.setAttribute("class", cls);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  const short = (name) =>
    name.replace("Chilled water pump", "CHW pump").replace("Generator", "Gen").replace(" diesel tank", " fuel").replace("Main incomer", "Main in").slice(0, 12);
  const headline = (a) => (a.headline ? `${fmt(a.headline.value)} ${UNIT[a.headline.unit] ?? a.headline.unit}` : "-");
  const tooltip = (a) =>
    [`${a.name} (${a.id})`, ...a.alarms.map((x) => `${x.code} - ${x.active ? "active" : "cleared"}: ${x.message}`)].join("\n");

  /** Assign each asset a grid cell by type; unknown types fall into the next free cell. */
  function place(assets) {
    const used = new Set();
    const counts = {};
    const out = [];
    const nextFree = () => {
      for (let r = 0; r < 30; r++) for (let c = 0; c < 3; c++) if (!used.has(r + ":" + c)) return [r, c];
      return [29, 2];
    };
    for (const asset of assets) {
      const index = counts[asset.type] ?? 0;
      counts[asset.type] = index + 1;
      let slot = (SLOTS[asset.type] || [])[index];
      if (!slot || used.has(slot[0] + ":" + slot[1])) slot = nextFree();
      used.add(slot[0] + ":" + slot[1]);
      out.push({ asset, row: slot[0], col: slot[1] });
    }
    return out;
  }

  function askAbout(asset) {
    chatInput.value = `Tell me about ${asset.name} (${asset.id}).`;
    chatInput.dispatchEvent(new Event("input"));
    chatInput.focus();
  }

  function drawTile(p) {
    const a = p.asset;
    const x = X0 + p.col * (TILE_W + GAP);
    const y = Y0 + p.row * ROW_H;
    const g = snode("g", { tabindex: "0", role: "button", "aria-label": `${a.name}, ${STATUS_LABEL[a.status]}` }, "tile " + a.status);
    g.append(snode("title", {}, "", tooltip(a)));
    g.append(snode("rect", { x, y, width: TILE_W, height: TILE_H, rx: 2 }));
    g.append(snode("text", { x: x + 6, y: y + 17 }, "t-name", short(a.name)));
    g.append(snode("text", { x: x + 6, y: y + 34 }, "t-val", headline(a)));
    g.addEventListener("click", () => askAbout(a));
    g.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        askAbout(a);
      }
    });
    state.tiles.set(a.id, g);
    return g;
  }

  function drawBuilding(b) {
    const placed = place(b.assets);
    const rows = Math.max(...placed.map((p) => p.row)) + 1;
    const H = Y0 + rows * ROW_H - 8;

    const card = el("div", "bcard");
    const head = el("div", "bhead");
    const title = el("span", "");
    title.append(el("span", "bname", b.name), " ", el("span", "bcity", b.city));
    head.append(title, el("span", "bstat " + b.status, STATUS_LABEL[b.status]));
    card.append(head);

    const svg = snode("svg", { viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": `Schematic of ${b.name}` });
    svg.append(snode("rect", { x: 6, y: 6, width: W - 12, height: H - 12 }, "t-frame"));
    for (let r = 0; r < rows; r++) {
      svg.append(snode("text", { x: X0, y: Y0 + r * ROW_H - 8 }, "t-label", ROW_LABELS[r] ?? "LEVEL " + (r + 1)));
    }
    for (const p of placed) svg.append(drawTile(p));
    card.append(svg);

    state.frames.set(b.id, card);
    return card;
  }

  function applyPulse(id) {
    const node = state.tiles.get(id) ?? state.frames.get(id);
    if (node) node.classList.toggle("pulse", (pulses.get(id) ?? 0) > 0);
  }
  function setPulse(id, on) {
    const n = (pulses.get(id) ?? 0) + (on ? 1 : -1);
    if (n > 0) pulses.set(id, n);
    else pulses.delete(id);
    applyPulse(id);
  }

  function render(snapshot) {
    state.meters = snapshot.meters;
    state.buildings = snapshot.buildings;
    state.tiles.clear();
    state.frames.clear();
    host.textContent = "";
    for (const b of snapshot.buildings) host.append(drawBuilding(b));
    for (const id of pulses.keys()) applyPulse(id);
  }

  async function refresh() {
    try {
      const res = await fetch("/api/twin");
      if (!res.ok) throw new Error("HTTP " + res.status);
      render(await res.json());
    } catch (err) {
      console.warn("twin refresh failed:", err);
      if (!host.querySelector(".bcard")) {
        host.textContent = "";
        host.append(el("div", "twin-empty", "Twin offline"));
      }
    }
  }

  /** Which tiles and buildings does this tool call touch? */
  function targetsFor(input) {
    const args = input && typeof input === "object" ? input : {};
    const ids = new Set();
    const assetId =
      typeof args.meter_id === "string" ? state.meters[args.meter_id] : typeof args.asset_id === "string" ? args.asset_id : undefined;
    if (assetId) {
      ids.add(assetId);
      for (const b of state.buildings) if (b.assets.some((a) => a.id === assetId)) ids.add(b.id);
      return [...ids];
    }
    const scope = typeof args.building_id === "string" ? state.buildings.filter((b) => b.id === args.building_id) : state.buildings;
    for (const b of scope) {
      ids.add(b.id);
      if (typeof args.asset_type === "string") for (const a of b.assets) if (a.type === args.asset_type) ids.add(a.id);
    }
    return [...ids];
  }

  function release(callId) {
    const call = callTargets.get(callId);
    if (!call) return;
    callTargets.delete(callId);
    const hold = Math.max(500, 1400 - (Date.now() - call.started));
    setTimeout(() => call.ids.forEach((id) => setPulse(id, false)), hold);
  }

  function onEvent(ev) {
    const d = ev.data;
    if (ev.event === "tool_start") {
      const ids = targetsFor(d.input);
      callTargets.set(d.id, { ids, started: Date.now() });
      ids.forEach((id) => setPulse(id, true));
    } else if (ev.event === "tool_result") {
      release(d.id);
    } else if (ev.event === "end") {
      for (const id of [...callTargets.keys()]) release(id);
      refresh();
    }
  }

  function install() {
    if (!window.OpsUi) return false;
    const previous = window.OpsUi.onEvent;
    window.OpsUi.onEvent = (ev) => {
      previous(ev);
      try {
        onEvent(ev);
      } catch (err) {
        console.warn("twin event skipped:", err);
      }
    };
    return true;
  }
  if (!install()) window.addEventListener("DOMContentLoaded", install);

  refresh();
  setInterval(refresh, 30000);
})();
