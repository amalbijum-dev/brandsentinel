"use strict";
// Shared helpers. Every dynamic value goes through textContent / setAttribute, never innerHTML, so user content cannot inject markup.

const state = { user: null, org: "", aiConfigured: false, setupRequired: false };
const views = {};

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(path, { method = "GET", body, form } = {}) {
  const opts = { method, headers: { "x-requested-with": "brandsentinel" }, credentials: "same-origin" };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch("/api" + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.user && !path.startsWith("/login")) {
      state.user = null;
      renderApp();
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function toast(message, isError = false) {
  const el = h("div", { class: "toast" + (isError ? " err" : ""), role: isError ? "alert" : "status" }, message);
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), isError ? 7000 : 3500);
}

function busy(text) {
  const box = document.getElementById("busy");
  document.getElementById("busy-text").textContent = text || "Working…";
  box.hidden = !text;
}

/** Wraps an async click handler: shows errors as toasts and prevents double clicks. */
function guard(fn, { busyText } = {}) {
  return async event => {
    const btn = event?.currentTarget;
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    if (busyText) busy(busyText);
    try {
      await fn(event);
    } catch (e) {
      toast(e.message || "Something went wrong.", true);
    } finally {
      if (busyText) busy("");
      if (btn) btn.disabled = false;
    }
  };
}

const STATUS = {
  ai_checked: "AI checked (draft)",
  legal_review: "Legal review",
  manager_review: "Final check",
  changes_requested: "Changes requested",
  approved: "Approved",
  published: "Published"
};
const TYPES = { poster: "Poster", social_post: "Social post", reel: "Reel / video", document: "Document", ad: "Advertisement", other: "Other" };
const CATEGORY = {
  spelling: "Spelling", missing_info: "Missing info", claim: "Claim", brand_rule: "Brand rule", visual: "Visual",
  tone: "Tone / clarity", accessibility: "Accessibility", audience: "Audience", ai_disclosure: "AI disclosure", other: "Other"
};

const badge = (text, cls = "") => h("span", { class: `badge b-${cls}` }, text);
const fmtDate = iso => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const statusBadge = s => badge(STATUS[s] || s, s);

function option(value, label, selected) {
  return h("option", { value, selected: selected ? true : null }, label);
}

function field(label, control, hint) {
  const id = "f" + Math.random().toString(36).slice(2, 8);
  control.id = id;
  return h("div", { class: "field" }, h("label", { for: id }, label), control, hint ? h("div", { class: "muted small" }, hint) : null);
}

function copyText(text) {
  return navigator.clipboard.writeText(text).then(() => toast("Copied"), () => toast("Could not copy", true));
}
