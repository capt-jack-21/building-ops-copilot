"use strict";

// Charts for query_timeseries results and the live agent-loop strip.
// Plain SVG/DOM only: no HTML parsing, no dependencies.
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const TIME_KEYS = ["t", "ts", "time", "timestamp", "timestamp_utc", "bucket_start", "bucket", "start", "start_utc"];
  const VALUE_KEYS = ["avg", "mean", "value", "v", "avg_value"];
  const SKIP_KEYS = ["count", "n", "samples", "min", "max"];

  const pad2 = (n) => String(n).padStart(2, "0");
  const toMs = (x) => {
    if (typeof x === "number") return x < 1e12 ? x * 1000 : x;
    if (typeof x === "string" && /\d{4}-\d{2}-\d{2}/.test(x)) return Date.parse(x);
    return NaN;
  };
  const fmtTime = (ms) => {
    const d = new Date(ms);
    return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  };
  const fmtVal = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

  function node(tag, cls, text) {
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

  /* ---------- find a time series inside a tool result ---------- */

  function findArrays(value, depth, out) {
    if (Array.isArray(value)) {
      out.push(value);
      return;
    }
    if (value && typeof value === "object" && depth < 3) {
      for (const v of Object.values(value)) findArrays(v, depth + 1, out);
    }
  }

  function extractSeries(parsed) {
    const arrays = [];
    findArrays(parsed, 0, arrays);
    for (const arr of arrays) {
      const probe = arr.slice(0, 10).filter((e) => e && typeof e === "object" && !Array.isArray(e));
      if (arr.length < 2 || probe.length === 0) continue;
      const keys = new Set(probe.flatMap((e) => Object.keys(e)));
      const tKey =
        TIME_KEYS.find((k) => keys.has(k) && probe.some((e) => Number.isFinite(toMs(e[k])))) ??
        [...keys].find((k) => probe.some((e) => typeof e[k] === "string" && Number.isFinite(toMs(e[k]))));
      if (!tKey) continue;
      const isNum = (k) => probe.some((e) => typeof e[k] === "number" && Number.isFinite(e[k]));
      const vKey =
        VALUE_KEYS.find((k) => k !== tKey && keys.has(k) && isNum(k)) ??
        [...keys].find((k) => k !== tKey && !SKIP_KEYS.includes(k) && isNum(k));
      if (!vKey) continue;
      const points = [];
      for (const e of arr) {
        if (!e || typeof e !== "object") continue;
        const t = toMs(e[tKey]);
        const v = e[vKey];
        if (Number.isFinite(t) && typeof v === "number" && Number.isFinite(v)) points.push({ t, v });
      }
      if (points.length >= 2) {
        points.sort((a, b) => a.t - b.t);
        return { points, key: vKey };
      }
    }
    return null;
  }

  /* ---------- draw the chart ---------- */

  function drawChart(points, title, unit, key) {
    const W = 640, H = 200, L = 46, R = 14, T = 20, B = 28;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const values = points.map((p) => p.v);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const avgV = values.reduce((a, b) => a + b, 0) / values.length;
    const lastV = values[values.length - 1];
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    let lo = minV;
    let hi = maxV;
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const margin = (hi - lo) * 0.08;
    hi += margin;
    lo = minV >= 0 ? Math.max(0, lo - margin) : lo - margin;

    const x = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

    const figure = node("figure", "chart");
    const head = node("div", "chart-head");
    head.append(node("span", "chart-title", title + (unit ? " (" + unit + ")" : "")));
    const stats = node("span", "chart-stats");
    for (const [label, val] of [["min", minV], ["avg", avgV], ["max", maxV], ["last", lastV]]) {
      stats.append(label + " ", node("b", "", fmtVal(val)), "  ");
    }
    head.append(stats);

    const svg = snode("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Chart of ${title}` });

    for (let i = 0; i <= 3; i++) {
      const value = lo + ((hi - lo) * i) / 3;
      svg.append(snode("line", { x1: L, x2: W - R, y1: y(value), y2: y(value) }, "c-grid"));
      svg.append(snode("text", { x: L - 6, y: y(value) + 3.5, "text-anchor": "end" }, "c-axis", fmtVal(value)));
    }
    svg.append(snode("text", { x: L, y: H - 8, "text-anchor": "start" }, "c-axis", fmtTime(t0)));
    svg.append(snode("text", { x: (L + W - R) / 2, y: H - 8, "text-anchor": "middle" }, "c-axis", fmtTime((t0 + t1) / 2)));
    svg.append(snode("text", { x: W - R, y: H - 8, "text-anchor": "end" }, "c-axis", fmtTime(t1) + " UTC"));

    const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
    svg.append(snode("path", { d: `${line} L${x(t1).toFixed(1)} ${H - B} L${x(t0).toFixed(1)} ${H - B} Z` }, "c-area"));
    svg.append(snode("path", { d: line }, "c-line"));

    // Mark a deep dip, such as a tripped chiller.
    if (median > 0 && minV < median * 0.5) {
      const low = points.find((p) => p.v === minV);
      const lx = Math.min(W - R - 24, Math.max(L + 24, x(low.t)));
      svg.append(snode("circle", { cx: x(low.t), cy: y(low.v), r: 4 }, "c-low"));
      svg.append(snode("text", { x: lx, y: y(low.v) - 9, "text-anchor": "middle" }, "c-low-t", "low " + fmtVal(low.v)));
    }

    const hover = snode("g", { visibility: "hidden" });
    const cursor = snode("line", { y1: T, y2: H - B }, "c-cursor");
    const dot = snode("circle", { r: 4 }, "c-dot");
    const readout = snode("text", { x: L + 4, y: 12 }, "c-read", "");
    hover.append(cursor, dot, readout);
    svg.append(hover);

    const hit = snode("rect", { x: L, y: T, width: W - L - R, height: H - T - B }, "c-hit");
    hit.addEventListener("mousemove", (event) => {
      const box = svg.getBoundingClientRect();
      const mx = ((event.clientX - box.left) / box.width) * W;
      let best = points[0];
      let bestDistance = Infinity;
      for (const p of points) {
        const dist = Math.abs(x(p.t) - mx);
        if (dist < bestDistance) {
          bestDistance = dist;
          best = p;
        }
      }
      cursor.setAttribute("x1", x(best.t));
      cursor.setAttribute("x2", x(best.t));
      dot.setAttribute("cx", x(best.t));
      dot.setAttribute("cy", y(best.v));
      readout.textContent = `${fmtTime(best.t)} UTC   ${fmtVal(best.v)}${unit ? " " + unit : ""}`;
      hover.setAttribute("visibility", "visible");
    });
    hit.addEventListener("mouseleave", () => hover.setAttribute("visibility", "hidden"));
    svg.append(hit);

    figure.append(head, svg);
    if (key) figure.title = "plotted field: " + key;
    return figure;
  }

  function afterToolResult(card, d) {
    if (d.name !== "query_timeseries" || d.isError) return;
    try {
      const parsed = JSON.parse(d.content);
      const found = extractSeries(parsed);
      if (!found) return;
      const args = card.querySelector(".targs");
      const match = /meter_id=(\S+)/.exec(args ? args.textContent : "");
      const unit = parsed && typeof parsed === "object" && typeof parsed.unit === "string" ? parsed.unit : "";
      card.after(drawChart(found.points, match ? match[1] : "time series", unit, found.key));
    } catch (err) {
      console.warn("chart skipped:", err);
    }
  }

  /* ---------- live agent-loop strip ---------- */

  const nodes = {};
  for (const n of document.querySelectorAll("#loop .ln")) nodes[n.dataset.n] = n;
  const seen = new Set();
  let pendingTools = 0;

  function setLoop(active, waiting) {
    for (const [name, n] of Object.entries(nodes)) {
      n.classList.toggle("active", name === active && !waiting);
      n.classList.toggle("wait", name === active && Boolean(waiting));
      n.classList.toggle("seen", seen.has(name));
    }
  }

  function onEvent(ev) {
    switch (ev.event) {
      case "start":
        seen.clear();
        pendingTools = 0;
        seen.add("you");
        setLoop("model");
        break;
      case "model_call":
        seen.add("model");
        setLoop(ev.data.stopReason === "tool_use" ? "tools" : "answer");
        break;
      case "tool_start":
        pendingTools += 1;
        seen.add("tools");
        setLoop("tools");
        break;
      case "tool_result":
        pendingTools = Math.max(0, pendingTools - 1);
        if (pendingTools === 0) setLoop("model");
        break;
      case "approval_required":
        seen.add("approval");
        setLoop("approval", true);
        break;
      case "approval_result":
        setLoop("tools");
        break;
      case "done":
        seen.add("answer");
        setLoop("answer");
        break;
      case "stopped":
      case "error":
      case "end":
        setLoop(null);
        break;
      default:
        break;
    }
  }

  window.OpsUi = { onEvent, afterToolResult, extractSeries };
})();
