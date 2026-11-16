"use strict";

const $ = (selector) => document.querySelector(selector);
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
const fmt = (n) => Number(n).toLocaleString("en-US");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const messages = $("#messages");
const welcome = $("#welcome");
const input = $("#input");
const sendBtn = $("#send");
const form = $("#composer");

const state = {
  sessionId: null,
  running: false,
  controller: null,
  turn: null,
  stick: true,
  totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, tools: 0 },
  risk: new Map(),
};

/* ---------- safe markdown: builds DOM nodes, never parses HTML ---------- */

function inline(parent, text) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parent.append(text.slice(last, match.index));
    const token = match[0];
    parent.append(token.startsWith("**") ? el("strong", "", token.slice(2, -2)) : el("code", "", token.slice(1, -1)));
    last = match.index + token.length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

function renderMarkdown(container, text) {
  container.textContent = "";
  let list = null;
  let para = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) {
        list = el("ul");
        container.append(list);
      }
      const item = el("li");
      inline(item, bullet[1]);
      list.append(item);
      para = null;
      continue;
    }
    list = null;
    if (!line.trim()) {
      para = null;
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      const h = el("p", "md-h");
      inline(h, heading[1]);
      container.append(h);
      para = null;
      continue;
    }
    if (!para) {
      para = el("p");
      container.append(para);
    } else {
      para.append(document.createElement("br"));
    }
    inline(para, line);
  }
}

/* ---------- scrolling and typing ---------- */

messages.addEventListener("scroll", () => {
  state.stick = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 120;
});
function scrollDown() {
  if (state.stick) messages.scrollTop = messages.scrollHeight;
}

/** Cosmetic typewriter: reveals already-complete text over at most 2.5 s. Click a message to skip. */
function typeInto(container, text, turn) {
  return new Promise((resolve) => {
    if (reduced || turn.skip || text.length < 2) {
      renderMarkdown(container, text);
      scrollDown();
      resolve();
      return;
    }
    const duration = Math.min(2500, Math.max(350, text.length * 5));
    const start = performance.now();
    const frame = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      if (progress >= 1 || turn.skip) {
        renderMarkdown(container, text);
        scrollDown();
        resolve();
        return;
      }
      renderMarkdown(container, text.slice(0, Math.floor(text.length * progress)));
      scrollDown();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/* ---------- status bar ---------- */

function renderStatus() {
  const t = state.totals;
  const totalInput = t.input + t.cacheRead + t.cacheWrite;
  const hit = totalInput > 0 ? Math.round((100 * t.cacheRead) / totalInput) : 0;
  $("#st-in").textContent = fmt(t.input);
  $("#st-out").textContent = fmt(t.output);
  $("#st-cr").textContent = fmt(t.cacheRead);
  $("#st-cw").textContent = fmt(t.cacheWrite);
  $("#st-hit").textContent = hit + "%";
  $("#st-calls").textContent = fmt(t.calls);
  $("#st-tools").textContent = fmt(t.tools);
  $("#st-sid").textContent = state.sessionId ? state.sessionId.slice(0, 8) : "-";
}

/* ---------- turn rendering ---------- */

function addUser(text) {
  welcome.hidden = true;
  const row = el("div", "msg user");
  row.append(el("div", "bubble", text));
  messages.append(row);
  state.stick = true;
  scrollDown();
}

function newTurn() {
  const root = el("div", "msg assistant");
  const body = el("div", "turn");
  const thinking = el("div", "thinking");
  thinking.append(el("span"), el("span"), el("span"));
  body.append(thinking);
  root.append(body);
  messages.append(root);
  scrollDown();
  return { body, thinking, tools: new Map(), approvals: new Map(), skip: false };
}

function add(turn, node) {
  turn.body.insertBefore(node, turn.thinking);
  scrollDown();
}

function pretty(value) {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function briefArgs(input) {
  if (!input || typeof input !== "object") return "";
  const text = Object.entries(input)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("  ");
  return text.length > 90 ? text.slice(0, 90) + "..." : text;
}

function toolCard(turn, d) {
  const risk = state.risk.get(d.name) ?? "read";
  const card = el("details", "tool");
  const summary = el("summary");
  const status = el("span", "tstatus", "running...");
  summary.append(el("span", "risk " + risk), el("span", "tname", d.name), el("span", "targs", briefArgs(d.input)), status);
  const body = el("div", "tool-body");
  const result = el("pre", "json", "waiting...");
  body.append(el("div", "lbl", "Input"), el("pre", "json", pretty(d.input)), el("div", "lbl", "Result"), result);
  card.append(summary, body);
  turn.tools.set(d.id, { card, status, result });
  add(turn, card);
}

function settleApproval(entry, label, cls) {
  if (entry.settled) return;
  entry.settled = true;
  clearInterval(entry.interval);
  entry.approve.disabled = true;
  entry.decline.disabled = true;
  entry.timer.textContent = "";
  entry.outcome.textContent = label;
  entry.outcome.className = "ap-result " + cls;
}

function approvalCard(turn, d) {
  const card = el("div", "approval");
  const approve = el("button", "btn primary", "Approve");
  const decline = el("button", "btn danger", "Decline");
  approve.type = "button";
  decline.type = "button";
  const timer = el("span", "ap-timer", "");
  const outcome = el("span", "ap-result", "");
  const actions = el("div", "ap-actions");
  actions.append(approve, decline, timer, outcome);
  card.append(el("div", "ap-title", "Approval needed: " + d.name), el("div", "ap-reason", d.reason), el("pre", "json", pretty(d.input)), actions);

  const entry = { approve, decline, timer, outcome, settled: false, interval: 0 };
  const deadline = Date.now() + 120000;
  const tick = () => {
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    timer.textContent = `Auto-denies in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  };
  tick();
  entry.interval = setInterval(tick, 1000);

  const respond = async (approved) => {
    approve.disabled = true;
    decline.disabled = true;
    try {
      const res = await fetch("/api/approvals/" + encodeURIComponent(d.id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: state.sessionId, approved }),
      });
      if (!res.ok) settleApproval(entry, "Expired or already answered", "no");
      // on success the server sends approval_result, which settles the card
    } catch {
      settleApproval(entry, "Could not reach the server", "no");
    }
  };
  approve.addEventListener("click", () => respond(true));
  decline.addEventListener("click", () => respond(false));

  turn.approvals.set(d.id, entry);
  const tool = turn.tools.get(d.id);
  if (tool) {
    tool.status.textContent = "awaiting approval";
    tool.status.className = "tstatus wait";
  }
  add(turn, card);
}

async function handle(turn, ev) { if (window.OpsUi) window.OpsUi.onEvent(ev);
  const d = ev.data;
  switch (ev.event) {
    case "session":
      state.sessionId = d.session_id;
      renderStatus();
      break;
    case "model_call": {
      const t = state.totals;
      t.input += d.inputTokens;
      t.output += d.outputTokens;
      t.cacheRead += d.cacheReadTokens;
      t.cacheWrite += d.cacheWriteTokens;
      t.calls += 1;
      renderStatus();
      const row = el("div", "step");
      row.append(el("span", "dot"), el("span", "", `Model call ${d.iteration} \u00b7 ${(d.ms / 1000).toFixed(1)}s \u00b7 ${d.stopReason}`));
      if (d.cacheReadTokens + d.cacheWriteTokens > 0) {
        row.append(el("span", "chip-cache", `cache ${fmt(d.cacheReadTokens)} read / ${fmt(d.cacheWriteTokens)} written`));
      }
      add(turn, row);
      break;
    }
    case "text": {
      const bubble = el("div", "bubble md");
      bubble.addEventListener("click", () => {
        turn.skip = true;
      });
      add(turn, bubble);
      await typeInto(bubble, d.text, turn);
      break;
    }
    case "tool_start":
      toolCard(turn, d);
      break;
    case "tool_result": {
      state.totals.tools += 1;
      renderStatus();
      const tool = turn.tools.get(d.id);
      if (tool) {
        tool.status.textContent = d.isError ? `error \u00b7 ${d.ms.toFixed(1)} ms` : `${d.ms.toFixed(1)} ms`;
        tool.status.className = "tstatus " + (d.isError ? "err" : "ok");
        tool.result.textContent = pretty(d.content);
        if (d.isError) tool.card.classList.add("error"); if (window.OpsUi) window.OpsUi.afterToolResult(tool.card, d);
      }
      break;
    }
    case "approval_required":
      approvalCard(turn, d);
      break;
    case "approval_result": {
      const entry = turn.approvals.get(d.id);
      if (entry) settleApproval(entry, d.approved ? "Approved" : "Declined or timed out", d.approved ? "ok" : "no");
      break;
    }
    case "warning":
      add(turn, el("div", "note warn", d.message));
      break;
    case "done": {
      const seconds = (d.totalMs / 1000).toFixed(1);
      add(turn, el("div", "note", `Done \u00b7 ${d.iterations} model calls \u00b7 ${d.toolCalls} tool calls \u00b7 ${seconds}s`));
      if (d.termination === "max_iterations") add(turn, el("div", "note warn", "Stopped after reaching the step limit."));
      if (d.termination === "max_tokens") add(turn, el("div", "note warn", "The answer was cut off (output limit reached)."));
      break;
    }
    case "stopped":
      add(turn, el("div", "note warn", "Stopped."));
      break;
    case "error":
      add(turn, el("div", "bubble error", d.message));
      break;
    default:
      break;
  }
}

/* ---------- networking ---------- */

async function* readSse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const data = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (data.length > 0) yield { event, data: JSON.parse(data.join("\n")) };
    }
  }
}

function setRunning(running) {
  state.running = running;
  sendBtn.textContent = running ? "Stop" : "Send";
  sendBtn.className = "btn " + (running ? "danger" : "primary");
}

async function send(text) {
  setRunning(true);
  addUser(text);
  const turn = newTurn(); if (window.OpsUi) window.OpsUi.onEvent({ event: "start", data: {} });
  state.turn = turn;
  const controller = new AbortController();
  state.controller = controller;

  // Events go into a queue; a consumer draws them in order, so animation never blocks the network.
  const queue = [];
  let wake = null;
  let finished = false;
  const push = (ev) => {
    queue.push(ev);
    const w = wake;
    wake = null;
    if (w) w();
  };
  const consumer = (async () => {
    for (;;) {
      const ev = queue.shift();
      if (ev) {
        try {
          await handle(turn, ev);
        } catch (err) {
          console.error("render error", err);
        }
        continue;
      }
      if (finished) break;
      await new Promise((resolve) => {
        wake = resolve;
      });
    }
  })();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId ?? undefined, message: text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let message = "Request failed (HTTP " + res.status + ")";
      try {
        message = (await res.json()).error.message;
      } catch {
        /* keep the generic message */
      }
      push({ event: "error", data: { message } });
    } else {
      for await (const ev of readSse(res)) push(ev);
    }
  } catch (err) {
    if (err && err.name === "AbortError") push({ event: "stopped", data: {} });
    else push({ event: "error", data: { message: "Connection lost. Is the server running?" } });
  }

  finished = true;
  if (wake) {
    const w = wake;
    wake = null;
    w();
  }
  await consumer;

  for (const entry of turn.approvals.values()) settleApproval(entry, "Cancelled", "no");
  turn.thinking.remove(); if (window.OpsUi) window.OpsUi.onEvent({ event: "end", data: {} });
  state.controller = null;
  setRunning(false);
  input.focus();
}

function stop() {
  if (state.turn) state.turn.skip = true;
  if (state.controller) state.controller.abort();
}

/* ---------- wiring ---------- */

function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.running) {
    stop();
    return;
  }
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  autosize();
  send(text);
});
input.addEventListener("input", autosize);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!state.running) form.requestSubmit();
  }
});

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => {
    if (!state.running) send(chip.textContent);
  });
}

$("#new-chat").addEventListener("click", () => {
  stop();
  for (const node of messages.querySelectorAll(".msg")) node.remove();
  welcome.hidden = false;
  state.sessionId = null;
  state.totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, tools: 0 };
  renderStatus();
  input.focus();
});

async function loadMeta() {
  const badge = $("#mode-badge");
  try {
    const [health, tools] = await Promise.all([
      fetch("/api/health").then((r) => r.json()),
      fetch("/api/tools").then((r) => r.json()),
    ]);
    badge.textContent = health.demo ? "DEMO \u00b7 scripted model" : health.model;
    badge.className = "badge " + (health.demo ? "demo" : "live");
    $("#tool-count").textContent = String(tools.length);
    const list = $("#tool-list");
    for (const tool of tools) {
      state.risk.set(tool.name, tool.risk);
      const item = el("li");
      item.title = tool.description;
      item.append(el("span", "", tool.name), el("span", "pill " + tool.risk, tool.risk));
      list.append(item);
    }
  } catch {
    badge.textContent = "offline";
    badge.className = "badge off";
  }
}

renderStatus();
loadMeta();
input.focus();

