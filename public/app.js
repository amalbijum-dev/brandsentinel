"use strict";

const root = document.getElementById("app");
const route = () => {
  const [, name, id] = (location.hash.slice(1) || "/dashboard").split("/");
  return { name: name || "dashboard", id };
};

// ---------- Auth ----------
function authView() {
  const setup = state.setupRequired;
  let activeRole = "manager";
  let isSignup = false;
  let emailVal = "";
  let pwVal = "";

  const container = h("div", { class: "auth" });

  function renderForm() {
    const name = h("input", { autocomplete: "name", placeholder: "e.g. Alex Morgan" });
    const org = h("input", { placeholder: "e.g. Northfield College", value: state.org || "" });
    const email = h("input", {
      type: "email",
      autocomplete: "username",
      placeholder: activeRole === "manager" ? "you@company.com" : "you@company.com",
      value: emailVal,
      oninput: e => { emailVal = e.target.value; }
    });
    const pw = h("input", {
      type: "password",
      autocomplete: (setup || isSignup) ? "new-password" : "current-password",
      value: pwVal,
      oninput: e => { pwVal = e.target.value; }
    });
    const err = h("p", { class: "small", style: "color:var(--red)", role: "alert" });

    const btnRoleMgr = h("button", {
      type: "button",
      class: "role-opt" + (activeRole === "manager" ? " active" : ""),
      onclick: () => { activeRole = "manager"; emailVal = ""; pwVal = ""; renderForm(); }
    },
      h("span", { class: "role-opt-title" }, "Manager"),
      h("span", { class: "role-opt-sub" }, "Brand kit, guidelines and approvals")
    );

    const btnRoleEmp = h("button", {
      type: "button",
      class: "role-opt" + (activeRole === "employee" ? " active" : ""),
      onclick: () => { activeRole = "employee"; emailVal = ""; pwVal = ""; renderForm(); }
    },
      h("span", { class: "role-opt-title" }, "Normal Employee"),
      h("span", { class: "role-opt-sub" }, "Uploads, findings and responses")
    );

    const roleSelector = h("div", { class: "role-selector" }, btnRoleMgr, btnRoleEmp);

    const perksCard = h("div", { class: "perks-card" },
      h("div", { class: "perks-title" }, activeRole === "manager" ? "Manager Permissions" : "Employee Permissions"),
      h("ul", { class: "perks-list" },
        ...(activeRole === "manager"
          ? [
              h("li", {}, "Edit brand guidelines, checklists, facts, and palette"),
              h("li", {}, "Approve or disapprove submissions with feedback comments"),
              h("li", {}, "Review problem findings and provide replies to employees")
            ]
          : [
              h("li", {}, "Upload PDF documents, images, and marketing copy"),
              h("li", {}, "Review problem findings (also visible to managers)"),
              h("li", {}, "Submit responses to problem findings (accept, modify, reject)")
            ]
        )
      )
    );

    const quickMgr = h("button", {
      type: "button", class: "quick-btn",
      onclick: () => {
        activeRole = "manager";
        emailVal = "manager@brandsentinel.local";
        pwVal = "password123";
        renderForm();
      }
    }, "Fill Manager Demo");

    const quickEmp = h("button", {
      type: "button", class: "quick-btn",
      onclick: () => {
        activeRole = "employee";
        emailVal = "employee@brandsentinel.local";
        pwVal = "password123";
        renderForm();
      }
    }, "Fill Employee Demo");

    const quickFill = h("div", { class: "quick-fill" },
      h("span", { class: "muted small", style: "width:100%" }, "Demo accounts:"),
      quickMgr, quickEmp
    );

    const submit = guard(async () => {
      err.textContent = "";
      try {
        if (setup) {
          const body = { name: name.value, org: org.value, email: email.value, password: pw.value };
          await api("/setup", { method: "POST", body });
        } else if (isSignup) {
          const body = { name: name.value, email: email.value, password: pw.value, role: activeRole };
          await api("/signup", { method: "POST", body });
        } else {
          const body = { email: email.value, password: pw.value, role: activeRole };
          await api("/login", { method: "POST", body });
        }
        await boot();
      } catch (e) { err.textContent = e.message; }
    });

    const toggleMode = h("div", { id: "bs-signup-link", class: "alt", style: "margin-top:14px;text-align:center" },
      isSignup
        ? ["Already have an account? ", h("a", { href: "#", onclick: e => { e.preventDefault(); isSignup = false; renderForm(); } }, "Sign in")]
        : ["New here? ", h("a", { href: "#", onclick: e => { e.preventDefault(); isSignup = true; renderForm(); } }, "Create an account")]
    );

    const form = h("form", { class: "card", onsubmit: e => { e.preventDefault(); submit({ currentTarget: e.target.querySelector("button.primary") }); } },
      h("h2", {}, setup ? "Initial Organisation Setup" : (isSignup ? `Sign up as ${activeRole === "manager" ? "Manager" : "Normal Employee"}` : `Sign in as ${activeRole === "manager" ? "Manager" : "Normal Employee"}`)),
      h("p", { class: "muted small" }, setup ? "First run: create the manager account for your organisation." : "Select your position to sign in:"),
      roleSelector,

      setup || isSignup ? field("Full name", name) : null,
      setup ? field("Organisation name", org) : null,
      field(activeRole === "manager" ? "Manager Email" : "Employee Email", email),
      field("Password", pw, (setup || isSignup) ? "At least 8 characters." : null),
      null,
      err,
      h("button", { class: "primary", type: "submit", style: "width:100%;margin-top:10px" },
        setup ? "Create Manager Account" : (isSignup ? `Sign up as ${activeRole === "manager" ? "Manager" : "Normal Employee"}` : `Sign in as ${activeRole === "manager" ? "Manager" : "Normal Employee"}`)),
      !setup ? toggleMode : null
    );

    container.replaceChildren(
      h("div", { class: "brand", style: "color:var(--text);margin-bottom:1rem" }, h("div", { class: "logo" }, shieldIcon()), "BrandSentinel"),
      form
    );
  }

  renderForm();
  return container;
}

function shieldIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 32 32"); svg.setAttribute("width", "18"); svg.setAttribute("height", "18");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", "M16 5l9 3.4v7.4c0 5.4-3.8 9.2-9 10.8-5.2-1.6-9-5.4-9-10.8V8.4z"); p.setAttribute("fill", "#fff");
  svg.append(p);
  return svg;
}

// ---------- Shell ----------
const NAV = [
  { id: "dashboard", label: "Dashboard", roles: ["creator", "employee", "reviewer", "manager"] },
  { id: "new", label: "New check (Upload)", roles: ["creator", "employee", "manager"] },
  { id: "submissions", label: "Submissions", roles: ["creator", "employee", "reviewer", "manager"] },
  { id: "kit", label: "Brand kit (Guidelines)", roles: ["creator", "employee", "reviewer", "manager"] },
  { id: "insights", label: "Insights", roles: ["reviewer", "manager"] },
  { id: "team", label: "Team", roles: ["manager"] },
  { id: "audit", label: "Audit log", roles: ["manager"] },
  { id: "settings", label: "Settings & API", roles: ["manager"] }
];

function sidebar(r) {
  return h("aside", { class: "side" },
    h("div", { class: "brand" }, h("div", { class: "logo" }, shieldIcon()), "BrandSentinel"),
    h("nav", { class: "nav", "aria-label": "Main" },
      NAV.filter(n => n.roles.includes(state.user.role)).map(n =>
        h("a", { href: `#/${n.id}`, class: r.name === n.id || (n.id === "submissions" && r.name === "submission") ? "active" : "" }, n.label))),
    h("div", { class: "userbox" },
      h("div", {}, h("strong", {}, state.user.name)), h("div", {}, ROLE_LABEL[state.user.role] || state.user.role),
      h("button", { class: "ghost sm", onclick: guard(async () => { await api("/logout", { method: "POST" }); state.user = null; location.hash = ""; await boot(); }) }, "Sign out"))
  );
}
const ROLE_LABEL = { creator: "Normal Employee", employee: "Normal Employee", reviewer: "Reviewer (legal / compliance)", manager: "Manager" };

function topbar() {
  const dd = h("div", { class: "dropdown", hidden: true });
  const count = h("span", { class: "dot", hidden: true });
  const bell = h("div", { class: "bell right" },
    h("button", { class: "sm", "aria-label": "Notifications", onclick: async () => {
      dd.hidden = !dd.hidden;
      if (!dd.hidden) { await api("/notifications/read", { method: "POST" }).catch(() => {}); count.hidden = true; }
    } }, "Notifications", count), dd);
  api("/notifications").then(list => {
    const unread = list.filter(n => !n.read).length;
    count.textContent = unread; count.hidden = !unread;
    dd.replaceChildren(...(list.length
      ? list.map(n => h("a", { href: n.submissionId ? `#/submission/${n.submissionId}` : "#", class: n.read ? "" : "unread", onclick: () => { dd.hidden = true; } }, n.text, h("div", { class: "muted small" }, fmtDate(n.at))))
      : [h("p", { class: "muted small", style: "padding:.5rem" }, "No notifications yet.")]));
  }).catch(() => {});
  return h("div", { class: "topbar" }, h("span", { class: "org" }, state.org),
    state.user && state.user.demo ? h("span", { title: "Shared demo account. Team, settings, API key and export changes are turned off." }, badge("Demo account · some admin actions disabled", "possible")) : null,
    state.aiConfigured ? null : badge("AI not configured: rule-based checks only", "possible"), bell);
}

let lastRoute = "";
async function renderApp() {
  if (!state.user) { location.replace("/login.html"); return; }
  const r = route();
  const key = r.name + "/" + (r.id || "");
  const y = key === lastRoute ? window.scrollY : 0;
  lastRoute = key;
  const view = h("div", { class: "view" }, h("p", { class: "muted" }, "Loading…"));
  root.replaceChildren(h("div", { class: "shell" }, sidebar(r), h("main", { class: "main" }, topbar(), view)));
  try {
    const fn = views[r.name];
    view.replaceChildren(fn ? await fn(r) : h("div", { class: "card" }, "Page not found."));
  } catch (e) {
    view.replaceChildren(h("div", { class: "card error" }, e.message));
  }
  window.scrollTo(0, y);
}

async function boot() {
  const s = await api("/session");
  Object.assign(state, { user: s.user, org: s.org, aiConfigured: s.ai_configured, setupRequired: s.setupRequired });
  await renderApp();
}
window.addEventListener("hashchange", renderApp);
boot().catch(e => root.replaceChildren(h("div", { class: "auth" }, h("div", { class: "card error" }, "Cannot reach the server: " + e.message))));

// ---------- Dashboard ----------
views.dashboard = async () => {
  const subs = await api("/submissions");
  const role = state.user.role;
  const isEmp = role === "creator" || role === "employee";
  const waiting = subs.filter(s => (role === "reviewer" && s.status === "legal_review") || (role === "manager" && ["legal_review", "manager_review"].includes(s.status)) || (isEmp && ["changes_requested", "ai_checked"].includes(s.status)));
  const count = st => subs.filter(s => st.includes(s.status)).length;
  const stat = (n, label) => h("div", { class: "card stat" }, h("b", {}, n), h("span", {}, label));
  return h("div", { class: "col" },
    h("h1", {}, `Welcome, ${state.user.name.split(" ")[0]}`),
    h("div", { class: "grid cols-4" },
      stat(subs.length, "Total submissions"),
      stat(count(["legal_review", "manager_review"]), "In review"),
      stat(count(["changes_requested"]), "Changes requested"),
      stat(count(["approved", "published"]), "Approved / published")),
    h("div", { class: "card" }, h("h2", {}, isEmp ? "Needs your attention" : "Waiting for you"),
      waiting.length ? submissionTable(waiting) : h("p", { class: "muted" }, "Nothing waiting. " + (role !== "reviewer" ? "Start with “New check”." : ""))),
    h("div", { class: "card" }, h("h2", {}, "How review works"),
      h("p", { class: "muted" }, "1. Creator uploads content, and BrandSentinel checks it against your brand kit. 2. The creator accepts, modifies or rejects each suggestion. 3. Sensitive content (unverified claims, ads, possible AI content) goes to legal/compliance. 4. A manager gives the final approval. AI suggests, humans decide, and every step is logged.")),
    subs.length ? h("div", { class: "card" }, h("h2", {}, "Recent activity"), submissionTable(subs.slice(0, 6))) : null
  );
};

function submissionTable(list) {
  return h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, ["Title", "Type", "Status", "Findings", "By", "Updated"].map(t => h("th", {}, t)))),
    h("tbody", {}, list.map(s => h("tr", { class: "click", tabindex: "0", onclick: () => { location.hash = `#/submission/${s.id}`; }, onkeydown: e => { if (e.key === "Enter") location.hash = `#/submission/${s.id}`; } },
      h("td", {}, h("strong", {}, s.title), h("div", { class: "muted small" }, `v${s.version}`)),
      h("td", {}, TYPES[s.contentType]),
      h("td", {}, statusBadge(s.status)),
      h("td", {}, s.counts.high ? badge(`${s.counts.high} high`, "high") : null, " ", s.counts.medium ? badge(`${s.counts.medium} med`, "medium") : null, " ", s.counts.low ? badge(`${s.counts.low} low`, "low") : null, !s.counts.high && !s.counts.medium && !s.counts.low ? badge("clean", "compliant") : null),
      h("td", {}, s.ownerName),
      h("td", { class: "small" }, fmtDate(s.updatedAt)))))));
}

views.submissions = async () => {
  const subs = await api("/submissions");
  let status = "all", q = "";
  const holder = h("div", {});
  const draw = () => holder.replaceChildren(
    submissionTable(subs.filter(s => (status === "all" || s.status === status) && s.title.toLowerCase().includes(q.toLowerCase())))
  );
  const sel = h("select", { onchange: e => { status = e.target.value; draw(); } }, option("all", "All statuses"), Object.entries(STATUS).map(([k, v]) => option(k, v)));
  const search = h("input", { placeholder: "Search titles…", oninput: e => { q = e.target.value; draw(); } });
  draw();
  return h("div", { class: "col" }, h("h1", {}, "Submissions"),
    h("div", { class: "row" }, h("div", { style: "width:220px" }, sel), h("div", { style: "width:260px" }, search)),
    h("div", { class: "card" }, subs.length ? holder : h("p", { class: "muted" }, "No submissions yet.")));
};

// ---------- New check ----------
views.new = async () => {
  if (state.user.role === "reviewer") return h("div", { class: "card" }, "Reviewers do not submit content.");
  let files = [];
  let video = null; // { frames, frameTimes, duration, name }
  const title = h("input", { maxlength: "120", placeholder: "e.g. Spectrum Fest poster v1" });
  const type = h("select", {}, Object.entries(TYPES).map(([k, v]) => option(k, v)));
  const audience = h("input", { placeholder: "e.g. first-year students, parents, 18-24" });
  const text = h("textarea", { placeholder: "Paste the copy, caption or script. You can also just upload a file." });
  const alt = h("input", { placeholder: "Describe the image for screen-reader users (optional)" });
  const fileInput = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,application/pdf,video/*", multiple: true });
  const previews = h("div", { class: "preview-grid" });
  const status = h("p", { class: "muted small" });
  const drop = h("div", { class: "drop" }, "Drop images, a PDF or a video here, or choose files", h("div", { style: "margin-top:.6rem" }, fileInput), status, previews);

  async function takeFiles(list) {
    const picked = [...list];
    const vid = picked.find(f => f.type.startsWith("video/"));
    previews.replaceChildren();
    video = null;
    if (vid) {
      files = [];
      status.textContent = "Reading video and picking keyframes at scene changes… 0%";
      try {
        const r = await extractVideo(vid, p => { status.textContent = `Reading video and picking keyframes at scene changes… ${p}%`; });
        video = { ...r, name: vid.name, file: vid };
        files = r.frames;
        type.value = "reel";
        status.textContent = `${r.frames.length} keyframe(s) selected from ${r.duration}s of video. The audio track (speech, voice-over, music) will be analysed too.`;
      } catch (e) { status.textContent = ""; toast(e.message, true); files = []; return; }
    } else {
      files = picked.slice(0, 9);
      status.textContent = files.length ? `${files.length} file(s) selected.` : "";
    }
    for (const f of files) {
      if (f.type.startsWith("image/")) previews.append(h("img", { src: URL.createObjectURL(f), alt: f.name }));
      else previews.append(h("span", { class: "badge" }, f.name));
    }
  }
  fileInput.addEventListener("change", () => takeFiles(fileInput.files));
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); takeFiles(e.dataTransfer.files); });

  const run = guard(async () => {
    if (!title.value.trim()) throw new Error("Give the content a title.");
    if (!text.value.trim() && !files.length) throw new Error("Add some text or upload a file.");
    const fd = new FormData();
    fd.set("title", title.value); fd.set("contentType", type.value); fd.set("audience", audience.value);
    fd.set("text", text.value); fd.set("altText", alt.value);
    files.forEach(f => fd.append("files", f));
    if (video) {
      fd.set("videoMeta", JSON.stringify({ name: video.name, duration: video.duration, frameTimes: video.frameTimes }));
      fd.set("video", video.file, video.name);
    }
    const colors = video ? video.colors : await colorsFromImages(files).catch(() => []);
    if (colors.length) fd.set("visual", JSON.stringify(colors));
    const sub = await api("/submissions", { method: "POST", form: fd });
    toast("Check complete");
    location.hash = `#/submission/${sub.id}`;
  }, { busyText: "Checking your content against the brand kit… videos take longer because the audio is analysed too." });

  return h("div", { class: "col", style: "max-width:820px" },
    h("h1", {}, "New content check"),
    h("div", { class: "card", style: "background:var(--blue-bg);border-color:var(--blue);margin-bottom:.4rem" },
      h("strong", { style: "color:var(--blue)" }, "Employee Permissions: "),
      "Upload PDF, images or copy to check against brand guidelines. Problem issues will be flagged for your response and can also be viewed and replied to by the manager."
    ),
    h("div", { class: "card" },
      field("Title", title),
      h("div", { class: "grid cols-2" }, field("Content type", type), field("Intended audience", audience, "Used to estimate whether the content actually suits them.")),
      field("Text / copy", text),
      drop,
      h("div", { style: "height:.8rem" }),
      field("Image alt text", alt, "Needed for accessibility on social posts, ads and documents."),
      h("button", { class: "primary", onclick: run }, "Analyse content"),
      h("p", { class: "muted small", style: "margin-top:.6rem" }, "Emails, phone numbers, Aadhaar and PAN numbers in pasted text are redacted before the AI call. Findings are suggestions, and a person makes the final call.")));
};

// ---------- Submission detail ----------
const sevOrder = { high: 0, medium: 1, low: 2 };

function pipeline(sub) {
  const sensitive = sub.versions[sub.versions.length - 1].report.sensitive.required;
  const idx = { ai_checked: 0, changes_requested: 0, legal_review: 1, manager_review: 2, approved: 3, published: 4 }[sub.status];
  const steps = [["Draft & AI check", "rules + AI"], ["Legal review", sensitive ? "required" : "not needed"], ["Final check", "manager"], ["Approved", ""], ["Published", ""]];
  return h("div", { class: "pipeline" }, steps.map(([name, note], i) => {
    let cls = "step";
    if (sub.status === "published" || i < idx) cls += " done";
    if (i === idx && sub.status !== "published") cls += sub.status === "changes_requested" ? " bad" : " current";
    if (i === 1 && !sensitive && idx > 1) cls = "step skipped";
    return h("div", { class: cls }, name, h("small", {}, i === 0 && sub.status === "changes_requested" ? "changes requested" : note));
  }));
}

function fileView(sub, version) {
  if (!version.files.length) return null;
  const url = i => `/api/submissions/${sub.id}/versions/${version.n}/files/${i}`;
  const images = version.files.map((f, i) => ({ f, i })).filter(x => x.f.mime.startsWith("image/"));
  const pdfs = version.files.map((f, i) => ({ f, i })).filter(x => x.f.mime === "application/pdf");
  return h("div", { class: "col" },
    version.videoMeta ? h("p", { class: "muted small" }, `Video “${version.videoMeta.name}” (${version.videoMeta.duration}s): ${images.length} keyframes at ${version.videoMeta.frameTimes.join("s, ")}s.`) : null,
    images.length === 1 ? h("img", { class: "preview", src: url(images[0].i), alt: images[0].f.name }) : h("div", { class: "preview-grid" }, images.map(x => h("img", { src: url(x.i), alt: x.f.name }))),
    pdfs.map(x => h("iframe", { class: "pdf", src: url(x.i), title: x.f.name })));
}

function issueCard(sub, version, issue, canDecide) {
  const me = state.user;
  const isManager = me?.role === "manager";
  const decision = version.decisions[issue.id];

  const note = h("input", { placeholder: "Note (required to reject)", value: decision?.note || "", "aria-label": "Note" });
  const decide = d => guard(async () => {
    await api(`/submissions/${sub.id}/decisions`, { method: "POST", body: { issueId: issue.id, decision: d, note: note.value } });
    renderApp();
  });

  const replyInput = h("input", { placeholder: "Write manager reply on this issue…", value: decision?.managerReply || "" });
  const sendReply = guard(async () => {
    if (!replyInput.value.trim()) throw new Error("Enter a reply first.");
    await api(`/submissions/${sub.id}/issues/${issue.id}/reply`, { method: "POST", body: { reply: replyInput.value } });
    toast("Manager reply sent to employee");
    renderApp();
  });

  const employeeResponseBadge = decision?.decision
    ? h("span", { class: "right" },
        badge(`Employee: ${decision.decision}`, decision.decision === "accepted" ? "supported" : (decision.decision === "rejected" ? "high" : "medium")),
        decision.note ? h("span", { class: "muted small", style: "margin-left:6px" }, `"${decision.note}"`) : null)
    : null;

  const managerReplyBox = decision?.managerReply
    ? h("div", { class: "manager-reply-box" },
        h("strong", {}, `Manager reply (${decision.managerReplyBy || "Manager"}): `),
        decision.managerReply,
        decision.managerReplyAt ? h("span", { class: "muted small", style: "margin-left:8px" }, fmtDate(decision.managerReplyAt)) : null)
    : null;

  return h("div", { class: `issue sev-${issue.severity}` },
    h("div", { class: "row" },
      badge(issue.severity, issue.severity),
      badge(issue.certainty === "confirmed" ? "confirmed" : "possible, verify", issue.certainty),
      badge(CATEGORY[issue.category] || issue.category),
      badge(issue.source === "rule" ? "rule engine" : "AI"),
      employeeResponseBadge
    ),
    h("h4", {}, issue.title),
    h("p", {}, issue.description),
    issue.evidence ? h("blockquote", {}, issue.evidence) : null,
    h("div", { class: "suggest" },
      h("strong", {}, "Suggested fix: "), issue.suggestion,
      issue.suggested_text ? h("div", { class: "row", style: "margin-top:.4rem" },
        h("code", {}, issue.suggested_text),
        h("button", { class: "sm", onclick: () => copyText(issue.suggested_text) }, "Copy")
      ) : null
    ),
    issue.guideline_reference ? h("div", { class: "muted small" }, "Source: ", issue.guideline_reference) : null,
    managerReplyBox,

    // Employee perk: Can give responses to the problems
    canDecide && !isManager ? h("div", { class: "decision" },
      h("span", { class: "muted small", style: "width:100%" }, "Your response to this problem:"),
      note,
      h("button", { class: "sm" + (decision?.decision === "accepted" ? " on" : ""), onclick: decide("accepted") }, "Accept"),
      h("button", { class: "sm" + (decision?.decision === "modified" ? " on" : ""), onclick: decide("modified") }, "I changed it my way"),
      h("button", { class: "sm" + (decision?.decision === "rejected" ? " on" : ""), onclick: decide("rejected") }, "Reject"),
      h("button", { class: "sm" + (decision?.decision === "unclear" ? " on" : ""), onclick: decide("unclear"), title: "Tells managers this guideline is confusing" }, "Guideline unclear")
    ) : null,

    // Manager perk: Checks the problems and can give reply
    isManager ? h("div", { class: "manager-reply-form" },
      h("span", { class: "muted small", style: "width:100%" }, "Manager reply to this problem:"),
      replyInput,
      h("button", { class: "sm primary", onclick: sendReply }, decision?.managerReply ? "Update reply" : "Send reply")
    ) : null
  );
}

function reportView(sub, version, canDecide) {
  const r = version.report;
  const issues = [...r.issues].sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
  const sections = [];
  sections.push(h("div", { class: "card" },
    h("div", { class: "row" }, h("h2", { style: "margin:0" }, `Findings (${issues.length})`), badge(r.status === "compliant" ? "No blocking issues" : "Needs review", r.status === "compliant" ? "compliant" : "medium"),
      badge(r.engine === "rules-only" ? "rule-based only" : `${r.engine}${r.model ? ` · ${r.model}` : ""}`)),
    h("p", { class: "muted" }, r.summary),
    issues.length ? issues.map(i => issueCard(sub, version, i, canDecide)) : h("p", {}, "No issues found. A person still makes the final decision.")));

  if (r.claims.length) sections.push(h("div", { class: "card" }, h("h3", {}, "Claim verification"),
    h("p", { class: "muted small" }, "Each claim is checked against your approved facts by the AI and by a separate rule-based second opinion. Disagreements go to a human."),
    h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Claim", "Verdict", "Approved fact", "Why"].map(t => h("th", {}, t)))),
      h("tbody", {}, r.claims.map(c => h("tr", {}, h("td", {}, c.claim), h("td", {}, badge(c.verdict.replace("_", " "), c.verdict)), h("td", { class: "small" }, c.fact_id || "none"), h("td", { class: "small" }, c.explanation))))))));

  if (r.checklist.length) sections.push(h("div", { class: "card" }, h("h3", {}, "Required information"),
    r.checklist.map(list => h("div", {}, h("strong", {}, list.name), h("ul", {}, list.results.map(x => h("li", {}, x.found ? "" : (x.required ? "" : "– "), x.label, x.found ? h("span", { class: "muted small" }, ` (found: ${x.matched.slice(0, 40)})`) : (x.required ? "" : " (optional)"))))))));

  const aud = r.audience;
  sections.push(h("div", { class: "card" }, h("h3", {}, "Audience relevance"),
    aud.estimated_audience || aud.stated ? h("div", {},
      h("p", {}, "Intended: ", h("strong", {}, aud.stated || "not stated"), " · Estimated: ", h("strong", {}, aud.estimated_audience || "unknown"), " ", badge(aud.match, aud.match === "mismatch" ? "high" : aud.match === "partial" ? "medium" : aud.match === "match" ? "match" : "")),
      h("p", { class: "muted" }, aud.reasoning), aud.suggestions?.length ? h("ul", {}, aud.suggestions.map(s => h("li", {}, s))) : null)
      : h("p", { class: "muted" }, "No audience was stated or the AI check did not run.")));

  sections.push(h("div", { class: "grid cols-2" },
    h("div", { class: "card" }, h("h3", {}, "Visual & accessibility measurements"),
      r.visual.colors.length ? h("div", {}, r.visual.colors.map(c => h("span", { class: "swatch" }, h("i", { style: `background:${c.hex}` }), `${c.hex} · ${Math.round(c.share * 100)}%`, c.nearest ? h("span", { class: "muted" }, ` (ΔE ${c.nearest.deltaE} from ${c.nearest.name})`) : null)))
        : h("p", { class: "muted" }, "No colour data (text-only or PDF)."),
      r.readability ? h("p", {}, `Readability: Flesch ${r.readability.flesch} (${r.readability.band})`) : null),
    h("div", { class: "card" }, h("h3", {}, "AI-generated content signal"),
      h("p", {}, badge(r.ai_detection.likelihood, r.ai_detection.likelihood === "high" ? "high" : r.ai_detection.likelihood === "medium" ? "medium" : ""), " ", r.ai_detection.reasoning),
      h("p", { class: "muted small" }, r.ai_detection.note))));

  sections.push(h("div", { class: "grid cols-2" },
    h("div", { class: "card" }, h("h3", {}, "Passed checks"), r.passed_checks.length ? h("ul", {}, r.passed_checks.map(p => h("li", {}, p))) : h("p", { class: "muted" }, "None recorded.")),
    h("div", { class: "card" }, h("h3", {}, "Limitations"), r.limitations.length ? h("ul", {}, r.limitations.map(p => h("li", {}, p))) : h("p", { class: "muted" }, "None recorded."))));
  if (r.audio) sections.push(h("details", { class: "card", open: true }, h("summary", {}, "Audio review (speech and sound)"),
    r.audio.summary ? h("p", {}, r.audio.summary) : null,
    r.audio.transcript && r.audio.transcript.length
      ? h("div", { class: "col small" }, r.audio.transcript.map(t => h("div", {}, h("span", { class: "muted", style: "font-family:var(--mono);margin-right:.6rem" }, t.time || ""), t.text)))
      : h("p", { class: "muted small" }, "No speech detected in the audio.")));
  if (r.extracted_text) sections.push(h("details", { class: "card" }, h("summary", {}, "Text read from the content (OCR)"), h("p", { class: "pre small" }, r.extracted_text)));
  return sections;
}

views.submission = async ({ id }) => {
  const sub = await api(`/submissions/${id}`);
  const me = state.user;
  const owner = sub.ownerId === me.id;
  const editable = ["ai_checked", "changes_requested"].includes(sub.status);
  const canEdit = editable && (owner || me.role === "manager");
  const key = `bs_v_${id}`;
  let n = Number(sessionStorage.getItem(key)) || sub.versions.length;
  if (!sub.versions.some(v => v.n === n)) n = sub.versions.length;
  const version = sub.versions.find(v => v.n === n);
  const isLatest = n === sub.versions.length;

  const actions = [];
  if (canEdit && isLatest) {
    actions.push(h("button", { class: "primary", onclick: guard(async () => {
      if (!confirm("Submit this version for review?")) return;
      await api(`/submissions/${id}/submit-for-review`, { method: "POST" }); toast("Submitted for review"); renderApp();
    }) }, "Submit for review"));
    actions.push(h("button", { onclick: guard(async () => { await api(`/submissions/${id}/reanalyse`, { method: "POST" }); toast("Re-analysed"); renderApp(); }, { busyText: "Re-running the analysis…" }) }, "Re-run analysis"));
  }
  const canManagerReview = me.role === "manager" && !["approved", "published"].includes(sub.status);
  const canLegalReview = me.role === "reviewer" && sub.status === "legal_review";
  if (canManagerReview || canLegalReview) {
    const comment = h("textarea", { placeholder: "Feedback comment (required if disapproving / returning for changes)", style: "min-height:70px" });
    const act = a => guard(async () => {
      await api(`/submissions/${id}/review`, { method: "POST", body: { action: a, comment: comment.value } });
      toast(a === "approve" ? "Approved" : "Disapproved / returned for changes");
      renderApp();
    });
    actions.push(h("div", { class: "review-actions col", style: "width:100%" },
      h("strong", {}, me.role === "manager" ? "Manager Decision: Review Submission" : "Legal Review"),
      comment,
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: act("approve") }, me.role === "manager" ? "Approve submission" : "Pass legal review"),
        h("button", { class: "danger", onclick: act("disapprove") }, me.role === "manager" ? "Request changes (Disapprove)" : "Return for changes")
      )
    ));
  }
  if (sub.status === "approved" && me.role === "manager")
    actions.push(h("button", { class: "primary", onclick: guard(async () => { await api(`/submissions/${id}/publish`, { method: "POST" }); renderApp(); }) }, "Mark as published"));
  if ((owner && !["approved", "published"].includes(sub.status)) || me.role === "manager")
    actions.push(h("button", { class: "danger", onclick: guard(async () => {
      if (!confirm("Delete this submission and its files permanently?")) return;
      await api(`/submissions/${id}`, { method: "DELETE" }); location.hash = "#/submissions";
    }) }, "Delete"));

  const verSel = h("select", { "aria-label": "Version", onchange: e => { sessionStorage.setItem(key, e.target.value); renderApp(); } },
    sub.versions.map(v => option(v.n, `Version ${v.n} · ${fmtDate(v.at)}`, v.n === n)));

  // Revision form
  let revise = null;
  if (canEdit && isLatest) {
    const t = h("textarea", {}, version.text);
    const aud = h("input", { value: sub.audience || "" });
    const alt = h("input", { value: version.altText || "" });
    const fi = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,application/pdf", multiple: true });
    const keep = h("input", { type: "checkbox", checked: version.files.length ? true : null });
    revise = h("details", { class: "card" }, h("summary", {}, h("strong", {}, "Revise and re-check (creates a new version)")),
      h("div", { style: "margin-top:.8rem" }, field("Text / copy", t), field("Intended audience", aud), field("Image alt text", alt),
        field("Replace files (optional)", fi, "Video: create a new check to re-sample keyframes."),
        version.files.length ? h("label", { class: "row" }, keep, "Keep the current files when no new files are chosen") : null,
        h("button", { class: "primary", onclick: guard(async () => {
          const fd = new FormData();
          fd.set("text", t.value); fd.set("audience", aud.value); fd.set("altText", alt.value);
          if (keep.checked) fd.set("keepFiles", "1");
          const files = [...fi.files];
          files.forEach(f => fd.append("files", f));
          if (files.length) { const colors = await colorsFromImages(files).catch(() => []); if (colors.length) fd.set("visual", JSON.stringify(colors)); }
          await api(`/submissions/${id}/revise`, { method: "POST", form: fd });
          sessionStorage.removeItem(key); toast("New version checked"); renderApp();
        }, { busyText: "Checking the new version…" }) }, "Check new version")));
  }

  const commentBox = h("textarea", { placeholder: "Add a comment…", style: "min-height:60px" });
  const lastReport = sub.versions[sub.versions.length - 1].report;

  return h("div", { class: "col" },
    h("a", { href: "#/submissions" }, "← All submissions"),
    h("div", { class: "row" }, h("h1", { style: "margin:0" }, sub.title), statusBadge(sub.status), badge(TYPES[sub.contentType]), h("span", { class: "muted small" }, `by ${sub.ownerName}`)),
    pipeline(sub),
    lastReport.sensitive.required ? h("div", { class: "card" }, h("strong", {}, "Needs human verification: "), lastReport.sensitive.reasons.join("; ")) : null,
    actions.length ? h("div", { class: "card row" }, actions) : null,
    h("div", { class: "grid cols-2" },
      h("div", { class: "card col" }, h("div", { class: "row" }, h("h2", { style: "margin:0" }, "Content"), h("div", { class: "right" }, verSel)),
        version.text ? h("p", { class: "pre" }, version.text) : h("p", { class: "muted" }, "No pasted text."), fileView(sub, version),
        !isLatest ? h("p", { class: "muted small" }, "You are viewing an older version. Switch to the latest version to act on it.") : null),
      h("div", { class: "card" }, h("h2", {}, "History"),
        h("ul", { class: "timeline" }, sub.timeline.map(t => h("li", {}, h("strong", {}, t.by), ` ${t.action}`, t.note ? h("div", { class: "muted small" }, t.note) : null, h("div", { class: "muted small" }, fmtDate(t.at)))),
        ))),
    revise,
    reportView(sub, version, canEdit && isLatest),
    h("div", { class: "card" }, h("h2", {}, "Comments"),
      sub.comments.length ? sub.comments.map(c => h("p", {}, h("strong", {}, c.by), ` (${c.role}) `, h("span", { class: "muted small" }, fmtDate(c.at)), h("br", {}), c.text)) : h("p", { class: "muted" }, "No comments yet."),
      commentBox, h("button", { onclick: guard(async () => { if (!commentBox.value.trim()) return; await api(`/submissions/${id}/comments`, { method: "POST", body: { text: commentBox.value } }); renderApp(); }) }, "Post comment"))
  );
};
