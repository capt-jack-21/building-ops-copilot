"use strict";

// HUD extras: UTC clock, cache gauge and tool log. Reads the page and the event hook only.
(function () {
  const $ = (selector) => document.querySelector(selector);
  const pad = (n) => String(n).padStart(2, "0");

  const clock = $("#clock");
  function tick() {
    const d = new Date();
    clock.textContent = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  }
  tick();
  setInterval(tick, 1000);

  const hit = $("#st-hit");
  const gauge = $("#gauge");
  function syncGauge() {
    const n = Math.max(0, Math.min(100, parseInt(hit.textContent, 10) || 0));
    gauge.style.setProperty("--hit", n + "%");
  }
  new MutationObserver(syncGauge).observe(hit, { childList: true, characterData: true, subtree: true });
  syncGauge();

  const log = $("#toollog");
  const rows = new Map();
  const MAX_ROWS = 40;

  function span(cls, text) {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    return s;
  }

  function logEvent(ev) {
    const d = ev.data;
    if (ev.event === "tool_start") {
      const empty = log.querySelector(".empty");
      if (empty) empty.remove();
      const d0 = new Date();
      const li = document.createElement("li");
      const status = span("s wait", "running");
      li.append(span("t", `${pad(d0.getUTCHours())}:${pad(d0.getUTCMinutes())}:${pad(d0.getUTCSeconds())}`), span("n", d.name), status);
      rows.set(d.id, status);
      log.prepend(li);
      while (log.children.length > MAX_ROWS) log.lastElementChild.remove();
    } else if (ev.event === "tool_result") {
      const status = rows.get(d.id);
      if (status) {
        status.textContent = d.isError ? "error" : `${d.ms.toFixed(1)} ms`;
        status.className = "s " + (d.isError ? "err" : "ok");
      }
    } else if (ev.event === "approval_required") {
      const status = rows.get(d.id);
      if (status) {
        status.textContent = "awaiting";
        status.className = "s wait";
      }
    } else if (ev.event === "approval_result") {
      const status = rows.get(d.id);
      if (status) {
        status.textContent = d.approved ? "approved" : "declined";
        status.className = "s " + (d.approved ? "ok" : "err");
      }
    }
  }

  function install() {
    if (!window.OpsUi) return false;
    const original = window.OpsUi.onEvent;
    window.OpsUi.onEvent = (ev) => {
      original(ev);
      try {
        logEvent(ev);
      } catch (err) {
        console.warn("tool log skipped:", err);
      }
    };
    return true;
  }
  if (!install()) window.addEventListener("DOMContentLoaded", install);
})();
