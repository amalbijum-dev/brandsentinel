const $ = id => document.getElementById(id);
const msg = (text, ok) => { const m = $("msg"); m.textContent = text; m.className = "msg " + (ok ? "ok" : "err"); };
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); kids.forEach(k => k != null && n.append(k)); return n; };
const tsec = t => { const p = String(t || "").split(":").map(Number); return p.some(isNaN) ? null : p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + (p[1] || 0); };
let player = null, current = null, objUrl = null;

fetch("/api/session").then(r => r.json()).then(s => { if (!s.user) location.href = "/"; });

// ---------- deterministic preflight (runs in the browser, no AI) ----------
function preflight(file) {
  const box = $("pre"); box.replaceChildren(); box.hidden = false;
  const v = document.createElement("video"); v.preload = "metadata"; v.src = URL.createObjectURL(file);
  v.onloadedmetadata = () => {
    const w = v.videoWidth, h = v.videoHeight, d = v.duration, ratio = w / h;
    const vertical = ratio < 0.7, ok = [
      ["Duration", `${Math.round(d)}s`, d <= 90 ? "good" : "warn"],
      ["Resolution", `${w}×${h}`, Math.min(w, h) >= 720 ? "good" : "warn"],
      ["Aspect", vertical ? "9:16 vertical" : ratio > 1.5 ? "16:9 wide" : "other", vertical ? "good" : "warn"],
      ["Size", `${(file.size / 1048576).toFixed(1)} MB`, file.size <= 60 * 1048576 ? "good" : "warn"]
    ];
    ok.forEach(([k, val, c]) => box.append(el("div", { className: "chip " + c }, el("small", { textContent: k }), el("b", { textContent: val }))));
    if (window.gsap) gsap.from(box.children, { y: 12, opacity: 0, stagger: .06, duration: .4 });
    URL.revokeObjectURL(v.src);
  };
}
$("video").addEventListener("change", e => { const f = e.target.files[0]; if (f) { preflight(f); if (objUrl) URL.revokeObjectURL(objUrl); objUrl = URL.createObjectURL(f); } });

// ---------- animated stage list while Gemini works ----------
const STAGES = ["Uploading video securely", "Transcribing speech & reading on-screen text", "Matching against brand guidelines & wording rules", "Fact-checking claims against approved sources", "Scoring and building the report"];
let stageTimer;
function startStages() {
  const s = $("stages"); s.hidden = false; s.replaceChildren();
  const rows = STAGES.map(t => { const r = el("div", { className: "stage" }, el("i"), t); s.append(r); return r; });
  let i = 0; rows[0].classList.add("run");
  if (window.gsap) gsap.from(rows, { x: -20, opacity: 0, stagger: .08, duration: .4 });
  stageTimer = setInterval(() => { if (i < rows.length - 1) { rows[i].className = "stage done"; rows[++i].className = "stage run"; } }, 7000);
}
function endStages() { clearInterval(stageTimer); $("stages").hidden = true; }

// ---------- rendering ----------
const band = n => n >= 80 ? "" : n >= 60 ? "mid" : "low";
const seek = t => { const s = tsec(t); if (player && s != null) { player.currentTime = s; player.play().catch(() => {}); player.scrollIntoView({ behavior: "smooth", block: "center" }); } };
const tsBtn = t => t ? el("button", { type: "button", className: "ts", textContent: "▶ " + t, onclick: () => seek(t) }) : null;

function ring(score) {
  const R = 74, C = 2 * Math.PI * R, ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg"); svg.setAttribute("width", 170); svg.setAttribute("height", 170);
  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML = '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ba7ff"/><stop offset="1" stop-color="#6ee7d0"/></linearGradient>';
  const bg = document.createElementNS(ns, "circle"), fg = document.createElementNS(ns, "circle");
  for (const [c, stroke] of [[bg, "rgba(255,255,255,.08)"], [fg, "url(#g)"]]) { c.setAttribute("cx", 85); c.setAttribute("cy", 85); c.setAttribute("r", R); c.setAttribute("fill", "none"); c.setAttribute("stroke", stroke); c.setAttribute("stroke-width", 12); c.setAttribute("stroke-linecap", "round"); }
  fg.setAttribute("stroke-dasharray", C); fg.setAttribute("stroke-dashoffset", C);
  svg.append(defs, bg, fg);
  const num = el("div", { className: "num" }, el("div", {}, el("span", { textContent: "0" }), el("small", { textContent: "BRAND SCORE" })));
  const wrap = el("div", { className: "ring" }, svg, num);
  const o = { v: 0 }, label = num.querySelector("span");
  if (window.gsap) { gsap.to(fg, { strokeDashoffset: C * (1 - score / 100), duration: 1.6, ease: "power3.out", delay: .3 }); gsap.to(o, { v: score, duration: 1.6, delay: .3, ease: "power3.out", onUpdate: () => label.textContent = Math.round(o.v) }); }
  else { fg.setAttribute("stroke-dashoffset", C * (1 - score / 100)); label.textContent = score; }
  return wrap;
}

const LABELS = { brand_voice: "Brand voice", messaging_accuracy: "Messaging accuracy", visual_identity: "Visual identity", audio_clarity: "Audio clarity", accessibility: "Accessibility", hook_strength: "Hook (first 3s)" };

function render(file, r) {
  current = { file, r };
  const out = $("out"); out.replaceChildren(); out.hidden = false;
  const vcls = r.overall_score >= 85 ? "ok" : r.overall_score >= 60 ? "mid" : "bad";

  const hero = el("div", { className: "hero" }, ring(r.overall_score || 0),
    el("div", {}, el("span", { className: "verdict " + vcls, textContent: r.verdict || r.status }),
      el("h2", { textContent: file }), el("p", { textContent: r.summary || "" }),
      r.top_fixes?.length ? el("div", {}, el("strong", { textContent: "Fix these first" }), el("ol", { className: "fixes" }, ...r.top_fixes.map(f => el("li", { textContent: f })))) : null));
  out.append(hero);

  // player + timeline with issue markers
  const left = el("div", { className: "panel" }, el("h3", { textContent: "Video & timeline" }));
  if (objUrl) { player = el("video", { className: "player", src: objUrl, controls: true, playsInline: true }); left.append(player); } else player = null;
  const dur = Math.max(1, ...[...(r.timeline || []).map(t => tsec(t.end)), ...(r.issues || []).map(i => tsec(i.timestamp))].filter(Boolean)) * 1.04;
  const track = el("div", { className: "track" });
  (r.timeline || []).forEach(t => { const a = tsec(t.start) || 0, b = tsec(t.end) || a + 1; const s = el("div", { className: "seg", title: t.note, textContent: t.label, onclick: () => seek(t.start) }); s.style.left = a / dur * 100 + "%"; s.style.width = Math.max(2, (b - a) / dur * 100) + "%"; track.append(s); });
  (r.issues || []).forEach(i => { const a = tsec(i.timestamp); if (a == null) return; const m = el("div", { className: "mark " + i.severity, title: `${i.timestamp} · ${i.title}`, onclick: () => seek(i.timestamp) }); m.style.left = a / dur * 100 + "%"; track.append(m); });
  left.append(track, el("p", { className: "legal", textContent: "Click a scene or a marker to jump to that moment." }));

  const dims = el("div", { className: "panel" }, el("h3", { textContent: "Score breakdown" }));
  Object.entries(r.scores || {}).forEach(([k, v]) => { const row = el("div", { className: "dim " + band(v) }, el("span", { textContent: LABELS[k] || k }), el("div", { className: "b" }, el("i")), el("em", { textContent: v })); row.querySelector("i").style.width = v + "%"; dims.append(row); });
  dims.append(el("p", { className: "legal", textContent: `AI-content signal: ${r.ai_signal.likelihood} (weak signal, never proof) · ${r.ai_signal.disclosure_present ? "disclosure shown" : "no AI disclosure found"}${r.ai_signal.signals.length ? " · " + r.ai_signal.signals.join("; ") : ""}` }),
    el("p", { className: "legal", textContent: `Logo ${r.logo_visible ? "visible" : "not detected"} · CTA ${r.call_to_action?.present ? "“" + (r.call_to_action.text || "present") + "”" : "missing"}` }));
  out.append(el("div", { className: "two" }, left, dims));

  // findings with filters
  const fp = el("div", { className: "panel" }, el("h3", { textContent: `Findings (${r.issues.length})` }));
  const list = el("div");
  const draw = f => { list.replaceChildren(); const items = r.issues.filter(i => f === "all" || i.severity === f); if (!items.length) list.append(el("p", { textContent: "Nothing here. ✔" }));
    items.forEach(i => { const box = el("div", { className: "issue " + i.severity }, el("h4", {}, el("span", { className: "tag", textContent: i.severity }), el("span", { className: "tag", textContent: i.category }), i.title, tsBtn(i.timestamp)));
      if (i.description) box.append(el("p", { textContent: i.description }));
      if (i.suggestion) box.append(el("p", { textContent: "Fix: " + i.suggestion }));
      if (i.guideline_reference) box.append(el("p", { className: "hint", textContent: "Source: " + i.guideline_reference }));
      list.append(box); });
    if (window.gsap) gsap.from(list.children, { y: 16, opacity: 0, stagger: .05, duration: .4 }); };
  const filters = el("div", { className: "filters" });
  ["all", "high", "medium", "low"].forEach(f => { const b = el("button", { type: "button", className: "fbtn" + (f === "all" ? " on" : ""), textContent: f, onclick: () => { filters.querySelectorAll(".fbtn").forEach(x => x.classList.remove("on")); b.classList.add("on"); draw(f); } }); filters.append(b); });
  fp.append(filters, list); out.append(fp); draw("all");

  // claims
  if (r.claims_checked?.length) {
    const t = el("table", { className: "vt" }, el("thead", {}, el("tr", {}, ...["When", "Claim", "Verdict", "Evidence"].map(h => el("th", { textContent: h })))));
    const tb = el("tbody"); r.claims_checked.forEach(c => tb.append(el("tr", {}, el("td", {}, tsBtn(c.timestamp) || ""), el("td", { textContent: c.claim }), el("td", { className: "v-" + c.verdict, textContent: c.verdict }), el("td", { textContent: c.evidence }))));
    t.append(tb); out.append(el("div", { className: "panel" }, el("h3", { textContent: "Claim verification vs approved facts" }), t));
  }

  const row = el("div", { className: "two" });
  if (r.transcript?.length) { const tr = el("div", { className: "tr" }); r.transcript.forEach(s => tr.append(el("p", {}, tsBtn(s.time) || "", " " + s.text))); row.append(el("div", { className: "panel" }, el("h3", { textContent: "Transcript" }), tr)); }
  if (r.suggested_rewrite) row.append(el("div", { className: "panel" }, el("h3", { textContent: "On-brand rewrite (suggestion only)" }), el("div", { className: "rewrite", textContent: r.suggested_rewrite })));
  if (row.children.length) out.append(row);

  const act = el("div", { className: "actions" },
    el("button", { className: "btn", type: "button", textContent: "Download report (JSON)", onclick: () => { const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: "application/json" })), download: "brandsentinel-video-report.json" }); a.click(); } }),
    el("button", { className: "btn ghostbtn", type: "button", textContent: "Print / save as PDF", onclick: () => print() }));
  out.append(act, el("p", { className: "legal", textContent: r.limitations.join(" ") + " Engine: " + (r.engine || "") }));
  out.scrollIntoView({ behavior: "smooth" });
}

// ---------- sample report so the UI can be demoed without API quota ----------
const SAMPLE = { overall_score: 68, verdict: "Fix before publishing", status: "needs_review", engine: "sample data (not an AI analysis)",
  summary: "Energetic 28s fest promo. Strong hook and visuals, but a wrong date, an unsupported price claim and low-contrast end card need fixing.",
  top_fixes: ["Change the fest date to the approved 14 March.", "Remove or source the “free entry for everyone” claim.", "Raise end-card text contrast and hold it for 3s."],
  scores: { brand_voice: 82, messaging_accuracy: 48, visual_identity: 74, audio_clarity: 70, accessibility: 55, hook_strength: 90 },
  timeline: [{ start: "00:00", end: "00:04", label: "Hook", note: "Crowd shot + title" }, { start: "00:04", end: "00:14", label: "Lineup", note: "Artist montage" }, { start: "00:14", end: "00:22", label: "Details", note: "Date, venue, price" }, { start: "00:22", end: "00:28", label: "End card", note: "Logo + link" }],
  transcript: [{ time: "00:01", text: "Spectrum Fest is back, bigger than ever." }, { time: "00:15", text: "Join us on 15 March at the main auditorium." }, { time: "00:19", text: "Free entry for everyone!" }],
  claims_checked: [{ claim: "Fest on 15 March", timestamp: "00:15", verdict: "contradicted", evidence: "Approved fact: Spectrum Fest 2027 is on 14 March." }, { claim: "Free entry for everyone", timestamp: "00:19", verdict: "unverified", evidence: "No approved fact covers pricing." }, { claim: "Main auditorium venue", timestamp: "00:16", verdict: "supported", evidence: "Approved venue: Main Auditorium." }],
  call_to_action: { present: true, text: "Register at the link in bio", note: "" }, logo_visible: true,
  suggested_rewrite: "Spectrum Fest is back, bigger than ever.\nJoin us on 14 March at the Main Auditorium.\nRegister at the link in bio.",
  issues: [{ id: "v1", severity: "high", category: "claim", title: "Wrong date spoken: 15 March", description: "Approved facts list the fest on 14 March.", suggestion: "Re-record the line with 14 March.", timestamp: "00:15", guideline_reference: "Approved facts" },
    { id: "v2", severity: "medium", category: "accessibility", title: "End card text has low contrast", description: "Light grey text on a bright background is hard to read.", suggestion: "Use the brand dark text colour and hold for 3 seconds.", timestamp: "00:24", guideline_reference: "Visual rules: contrast" },
    { id: "v3", severity: "medium", category: "audio", title: "Music drowns the voice-over", description: "Background track is too loud during the lineup section.", suggestion: "Duck music by 8 dB under speech.", timestamp: "00:08", guideline_reference: "" },
    { id: "v4", severity: "low", category: "claim", title: "Needs human verification: “Free entry for everyone”", description: "No approved fact supports this claim.", suggestion: "Add a source or remove it.", timestamp: "00:19", guideline_reference: "" }],
  passed_checks: ["Logo visible", "Call to action present"], ai_signal: { likelihood: "low", signals: [], disclosure_present: false }, audience_fit: { estimated_audience: "college students", matches: true, note: "" },
  limitations: ["Sample data for demonstration.", "AI review can miss issues; every finding is a suggestion for a human to decide."] };
$("sample").addEventListener("click", () => { msg("Showing sample data.", true); render("sample-fest-reel.mp4", SAMPLE); });

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const f = $("video").files[0];
  if (!f) return msg("Choose a video first.", false);
  if (f.size > 60 * 1024 * 1024) return msg("That video is over 60 MB.", false);
  const fd = new FormData();
  fd.append("video", f); fd.append("contentType", $("type").value); fd.append("audience", $("audience").value);
  $("go").disabled = true; $("out").hidden = true; msg("Analysing. This can take a minute or two…", true); startStages();
  try {
    const res = await fetch("/api/video-check", { method: "POST", headers: { "x-requested-with": "brandsentinel" }, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Video check failed.");
    msg("Done.", true); endStages(); render(data.file, data.report);
  } catch (err) { endStages(); msg(err.message, false); }
  finally { $("go").disabled = false; }
});
