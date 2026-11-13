"use strict";

// ---------- Brand kit ----------
let kitTab = "guidelines";
let kitEdit = null; // { col, id } where id is an item id or "new"

const CHECK_TYPES = ["keyword", "date", "time", "url", "email", "phone"];
const KIT = {
  guidelines: {
    label: "Guidelines", blank: { title: "", body: "" },
    fields: [{ k: "title", label: "Title" }, { k: "body", label: "Rules (plain text)", type: "area" }],
    show: g => [h("strong", {}, g.title, g.imported ? h("span", { class: "muted small" }, "  (imported)") : null), h("p", { class: "pre muted small" }, g.body.length > 500 ? g.body.slice(0, 500) + "…" : g.body)]
  },
  checklists: {
    label: "Required-info checklists", blank: { name: "", contentType: "poster", items: [] },
    fields: [
      { k: "name", label: "Checklist name" },
      { k: "contentType", label: "Applies to", type: "select", options: [["all", "All content types"], ...Object.entries(TYPES)] },
      { k: "items", label: "Items, one per line", type: "area", hint: "Format: Label | type | words to look for | required or optional. Types: keyword, date, time, url, email, phone. Example: Venue | keyword | auditorium, hall | required" }
    ],
    toForm: c => ({ ...c, items: c.items.map(i => `${i.label} | ${i.type} | ${i.patterns || ""} | ${i.required === false ? "optional" : "required"}`).join("\n") }),
    fromForm: v => ({
      name: v.name, contentType: v.contentType,
      items: v.items.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
        const [label, type = "keyword", patterns = "", req = "required"] = line.split("|").map(s => s.trim());
        if (!CHECK_TYPES.includes(type)) throw new Error(`Unknown type “${type}”. Use: ${CHECK_TYPES.join(", ")}.`);
        return { label, type, patterns, required: req.toLowerCase() !== "optional" };
      })
    }),
    show: c => [h("strong", {}, c.name), " ", badge(c.contentType === "all" ? "all types" : TYPES[c.contentType]),
      h("ul", {}, c.items.map(i => h("li", {}, i.label, h("span", { class: "muted small" }, ` · ${i.type}${i.patterns ? ` · ${i.patterns}` : ""}${i.required === false ? " · optional" : ""}`))))]
  },
  terms: {
    label: "Wording rules", blank: { avoid: "", prefer: "", note: "" },
    fields: [{ k: "avoid", label: "Avoid this wording" }, { k: "prefer", label: "Use instead (blank = remove)" }, { k: "note", label: "Why (shown to creators)" }],
    show: t => [h("strong", {}, `“${t.avoid}”`), " → ", t.prefer ? `“${t.prefer}”` : "remove", t.note ? h("div", { class: "muted small" }, t.note) : null]
  },
  facts: {
    label: "Approved facts", blank: { text: "", source: "" },
    fields: [{ k: "text", label: "Fact (one clear statement)", type: "area" }, { k: "source", label: "Source (optional)" }],
    show: f => [h("code", {}, f.id), " ", f.text, f.source ? h("div", { class: "muted small" }, `Source: ${f.source}`) : null]
  }
};

function kitEditor(col, item) {
  const def = KIT[col];
  const values = def.toForm ? def.toForm(item || def.blank) : { ...(item || def.blank) };
  const inputs = {};
  const form = h("div", { class: "card col" });
  for (const f of def.fields) {
    const el = f.type === "select" ? h("select", {}, f.options.map(([v, l]) => option(v, l, values[f.k] === v)))
      : f.type === "area" ? h("textarea", {}, values[f.k] || "") : h("input", { value: values[f.k] || "" });
    inputs[f.k] = el;
    form.append(field(f.label, el, f.hint));
  }
  form.append(h("div", { class: "row" },
    h("button", { class: "primary", onclick: guard(async () => {
      const raw = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
      const body = def.fromForm ? def.fromForm(raw) : raw;
      if (item) await api(`/kit/${col}/${item.id}`, { method: "PUT", body });
      else await api(`/kit/${col}`, { method: "POST", body });
      kitEdit = null; toast("Saved"); renderApp();
    }) }, "Save"),
    h("button", { onclick: () => { kitEdit = null; renderApp(); } }, "Cancel")));
  return form;
}

views.kit = async () => {
  const kit = await api("/kit");
  const mgr = state.user.role === "manager";
  const tabs = h("div", { class: "tabs" }, [...Object.entries(KIT).map(([k, d]) => [k, d.label]), ["palette", "Palette & logos"]].map(([k, label]) =>
    h("button", { class: kitTab === k ? "on" : "", onclick: () => { kitTab = k; kitEdit = null; renderApp(); } }, label)));
  const head = h("div", { class: "col" }, h("h1", {}, "Brand kit"),
    mgr
      ? h("div", { class: "card", style: "background:var(--blue-bg);border-color:var(--blue);margin-bottom:.4rem" },
          h("strong", { style: "color:var(--blue)" }, "Manager access: "),
          "You have full permission to edit, import, and manage brand guidelines, checklists, wording rules, approved facts, and logos."
        )
      : h("div", { class: "card", style: "background:var(--grey-bg);margin-bottom:.4rem" },
          h("strong", {}, "Normal Employee: "),
          "Viewing brand guidelines in read-only mode. Content checks are evaluated against these rules. Only Managers can edit guidelines."
        ),
    h("p", { class: "muted" }, "Everything BrandSentinel checks against. Findings can only cite these sources."), tabs);

  if (!kit.guidelines.length && !kit.facts.length && mgr) {
    head.append(h("div", { class: "card" }, h("p", {}, "Your kit is empty. Load a fictional college-fest kit to try the platform, or add your own guidelines."),
      h("button", { class: "primary", onclick: guard(async () => { await api("/kit/demo/load", { method: "POST" }); toast("Demo kit loaded"); renderApp(); }) }, "Load demo kit")));
  }

  if (kitTab === "palette") return h("div", { class: "col" }, head, await paletteTab(kit, mgr));

  const def = KIT[kitTab];
  const list = kit[kitTab];
  const body = h("div", { class: "col" });
  if (mgr) {
    const bar = h("div", { class: "row" }, h("button", { class: "primary", onclick: () => { kitEdit = { col: kitTab, id: "new" }; renderApp(); } }, `Add ${def.label.toLowerCase().replace(/s$/, "")}`));
    if (kitTab === "guidelines") {
      const fi = h("input", { type: "file", accept: "application/pdf,image/png,image/jpeg,image/webp,text/plain,text/markdown,.md,.txt", style: "width:auto" });
      bar.append(fi, h("button", { onclick: guard(async () => {
        if (!fi.files[0]) throw new Error("Choose a PDF, image or text file first.");
        const fd = new FormData(); fd.set("file", fi.files[0]);
        await api("/kit/guidelines/import", { method: "POST", form: fd });
        toast("Guidelines imported"); renderApp();
      }, { busyText: "Reading the guideline document…" }) }, "Import PDF / text"));
    }
    body.append(bar);
  }
  if (kitEdit?.col === kitTab && kitEdit.id === "new") body.append(kitEditor(kitTab));
  for (const item of list) {
    if (kitEdit?.col === kitTab && kitEdit.id === item.id) { body.append(kitEditor(kitTab, item)); continue; }
    body.append(h("div", { class: "card row", style: "align-items:flex-start" }, h("div", { style: "flex:1;min-width:0" }, def.show(item)),
      mgr ? h("div", { class: "row" }, h("button", { class: "sm", onclick: () => { kitEdit = { col: kitTab, id: item.id }; renderApp(); } }, "Edit"),
        h("button", { class: "sm danger", onclick: guard(async () => { if (!confirm("Delete this entry?")) return; await api(`/kit/${kitTab}/${item.id}`, { method: "DELETE" }); renderApp(); }) }, "Delete")) : null));
  }
  if (!list.length) body.append(h("p", { class: "muted" }, "Nothing here yet."));
  return h("div", { class: "col" }, head, body);
};

async function paletteTab(kit, mgr) {
  const wrap = h("div", { class: "col" });
  const logos = h("div", { class: "card" }, h("h3", {}, "Reference logos"),
    h("p", { class: "muted small" }, "Up to 3 official logos. The AI compares logos in content against these and flags obvious differences as “possible”."),
    h("div", { class: "preview-grid" }, kit.logos.map(l => h("div", {}, h("img", { src: `/api/logos/${l.id}/file`, alt: l.name, style: "background:#fff;padding:6px" }), h("div", { class: "small" }, l.name),
      mgr ? h("button", { class: "sm danger", onclick: guard(async () => { await api(`/logos/${l.id}`, { method: "DELETE" }); renderApp(); }) }, "Remove") : null))),
    !kit.logos.length ? h("p", { class: "muted" }, "No logos uploaded.") : null);
  if (mgr) {
    const fi = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", style: "width:auto" });
    const nm = h("input", { placeholder: "Logo name", style: "width:200px" });
    logos.append(h("div", { class: "row", style: "margin-top:.6rem" }, nm, fi, h("button", { onclick: guard(async () => {
      if (!fi.files[0]) throw new Error("Choose an image (max 2 MB).");
      const fd = new FormData(); fd.set("file", fi.files[0]); fd.set("name", nm.value);
      await api("/logos", { method: "POST", form: fd }); renderApp();
    }) }, "Upload logo")));
  }

  const palette = h("div", { class: "card" }, h("h3", {}, "Approved palette"));
  if (!mgr) {
    palette.append(kit.palette.length ? kit.palette.map(c => h("span", { class: "swatch" }, h("i", { style: `background:${c.hex}` }), `${c.name} ${c.hex}`)) : h("p", { class: "muted" }, "No palette set."));
  } else {
    const settings = await api("/settings");
    let rows = settings.palette.map(p => ({ ...p }));
    const box = h("div", { class: "col" });
    const draw = () => {
      box.replaceChildren(...rows.map((p, i) => h("div", { class: "row" },
        h("input", { type: "color", value: p.hex, "aria-label": "Colour", oninput: e => { p.hex = e.target.value; } }),
        h("input", { value: p.name, placeholder: "Colour name", style: "width:200px", oninput: e => { p.name = e.target.value; } }),
        h("button", { class: "sm danger", onclick: () => { rows.splice(i, 1); draw(); } }, "Remove"))));
    };
    draw();
    palette.append(box, h("div", { class: "row", style: "margin-top:.6rem" },
      h("button", { onclick: () => { rows.push({ name: "", hex: "#2f6df0" }); draw(); } }, "Add colour"),
      h("button", { class: "primary", onclick: guard(async () => {
        await api("/settings", { method: "PUT", body: { org: settings.org, palette: rows, redactPii: settings.redactPii, webhookUrl: settings.webhookUrl } });
        toast("Palette saved");
      }) }, "Save palette")),
      h("p", { class: "muted small" }, "Dominant colours in uploaded images are compared to these with CIEDE2000. Colours more than ΔE 25 away (and not grey) are flagged as possible off-palette."));
  }
  wrap.append(palette, logos);
  return wrap;
}

// ---------- Insights ----------
views.insights = async () => {
  const d = await api("/insights");
  const stat = (n, label) => h("div", { class: "card stat" }, h("b", {}, n ?? "–"), h("span", {}, label));
  const maxCat = Math.max(1, ...Object.values(d.byCategory));
  return h("div", { class: "col" }, h("h1", {}, "Insights"),
    h("div", { class: "grid cols-4" }, stat(d.totals.submissions, "Submissions"), stat(d.totals.issues, "Findings raised"), stat(d.totals.resubmissions, "Revisions made"), stat(d.totals.avgVersionsToApproval, "Avg versions to approval")),
    h("div", { class: "card" }, h("h2", {}, "Guidelines that cause the most friction"),
      h("p", { class: "muted small" }, "Ranked by how often creators rejected a finding or marked the guideline unclear. These are the rules to rewrite or explain better."),
      d.guidelines.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Guideline / source", "Flagged", "Accepted", "Rejected", "Unclear"].map(t => h("th", {}, t)))),
        h("tbody", {}, d.guidelines.map(g => h("tr", {}, h("td", {}, g.reference), h("td", {}, g.flagged), h("td", {}, g.accepted + g.modified), h("td", {}, g.rejected), h("td", {}, g.unclear)))))) : h("p", { class: "muted" }, "No data yet.")),
    h("div", { class: "grid cols-2" },
      h("div", { class: "card" }, h("h3", {}, "Findings by category"),
        Object.entries(d.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => h("div", { class: "row", style: "margin-bottom:.4rem" }, h("span", { style: "width:130px" }, CATEGORY[k] || k), h("div", { class: "bar", style: "flex:1" }, h("i", { style: `width:${(v / maxCat) * 100}%` })), v))),
      h("div", { class: "card" }, h("h3", {}, "Most repeated mistakes"),
        d.topIssues.length ? h("ol", {}, d.topIssues.map(t => h("li", {}, `${t.title} `, h("span", { class: "muted" }, `×${t.count}`)))) : h("p", { class: "muted" }, "No data yet."))));
};

// ---------- Team ----------
views.team = async () => {
  const users = await api("/users");
  const name = h("input"), email = h("input", { type: "email" }), pw = h("input", { type: "password", autocomplete: "new-password" });
  const role = h("select", {}, option("creator", "Normal Employee"), option("reviewer", "Reviewer (legal / compliance)"), option("manager", "Manager"));
  return h("div", { class: "col" }, h("h1", {}, "Team"),
    h("div", { class: "card" }, h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Name", "Email", "Role", "Status", ""].map(t => h("th", {}, t)))),
      h("tbody", {}, users.map(u => h("tr", {}, h("td", {}, u.name), h("td", {}, u.email),
        h("td", {}, h("select", { "aria-label": "Role", onchange: guard(async e => { await api(`/users/${u.id}`, { method: "PATCH", body: { role: e.target.value } }); toast("Role updated"); renderApp(); }) },
          ["creator", "reviewer", "manager"].map(r => option(r, ROLE_LABEL[r], u.role === r)))),
        h("td", {}, badge(u.active ? "active" : "disabled", u.active ? "supported" : "high")),
        h("td", { class: "row" },
          h("button", { class: "sm", onclick: guard(async () => { await api(`/users/${u.id}`, { method: "PATCH", body: { active: !u.active } }); renderApp(); }) }, u.active ? "Disable" : "Enable"),
          h("button", { class: "sm", onclick: guard(async () => { const p = prompt(`New password for ${u.name} (min 8 characters):`); if (!p) return; await api(`/users/${u.id}`, { method: "PATCH", body: { password: p } }); toast("Password reset"); }) }, "Reset password"),
          u.id === state.user.id ? h("span", { class: "muted small" }, "(you)") : h("button", { class: "sm danger", onclick: guard(async () => { if (!confirm(`Remove ${u.name} (${u.email}) from the team? This cannot be undone.`)) return; await api(`/users/${u.id}`, { method: "DELETE" }); toast("Removed " + u.name); renderApp(); }) }, "Remove")))))))),
    h("div", { class: "card" }, h("h2", {}, "Add a team member"),
      h("div", { class: "grid cols-2" }, field("Name", name), field("Email", email), field("Temporary password", pw, "At least 8 characters."), field("Role", role)),
      h("button", { class: "primary", onclick: guard(async () => {
        await api("/users", { method: "POST", body: { name: name.value, email: email.value, password: pw.value, role: role.value } });
        toast("User added"); renderApp();
      }) }, "Add user")));
};

// ---------- Audit log ----------
views.audit = async () => {
  const rows = await api("/audit");
  return h("div", { class: "col" }, h("h1", {}, "Audit log"), h("p", { class: "muted" }, "The 300 most recent actions: who did what, and when."),
    h("div", { class: "card table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["When", "Who", "Action", "Target", "Detail"].map(t => h("th", {}, t)))),
      h("tbody", {}, rows.map(a => h("tr", {}, h("td", { class: "small" }, fmtDate(a.at)), h("td", {}, a.userName, a.role ? h("span", { class: "muted small" }, ` (${a.role})`) : null), h("td", {}, a.action),
        h("td", { class: "small" }, a.target.startsWith("s_") ? h("a", { href: `#/submission/${a.target}` }, a.target) : a.target), h("td", { class: "small" }, a.detail)))))));
};

// ---------- Settings & API ----------
views.settings = async () => {
  const [s, health] = await Promise.all([api("/settings"), api("/health")]);
  const org = h("input", { value: s.org });
  const redact = h("input", { type: "checkbox", checked: s.redactPii ? true : null });
  const hook = h("input", { value: s.webhookUrl, placeholder: "https://example.com/hooks/brandsentinel" });
  const keyOut = h("div", {});
  const origin = location.origin;
  return h("div", { class: "col", style: "max-width:860px" }, h("h1", {}, "Settings & API"),
    h("div", { class: "card" }, h("h2", {}, "Organisation & privacy"),
      field("Organisation name", org),
      h("label", { class: "row" }, redact, "Redact emails and phone numbers from text before sending it to the AI model"),
      h("p", { class: "muted small" }, "Aadhaar and PAN numbers are always redacted. Text inside images and PDFs cannot be redacted before upload."),
      h("p", {}, "AI status: ", health.ai_configured ? badge(`connected · ${health.model}`, "supported") : badge("not configured", "high")),
      h("button", { class: "primary", onclick: guard(async () => {
        await api("/settings", { method: "PUT", body: { org: org.value, palette: s.palette, redactPii: redact.checked, webhookUrl: s.webhookUrl } });
        state.org = org.value; toast("Saved");
      }) }, "Save")),
    h("div", { class: "card" }, h("h2", {}, "Webhook"),
      field("Webhook URL", hook, "Receives analysis.completed and submission.status_changed events, signed with HMAC-SHA256 in the x-brandsentinel-signature header."),
      s.webhookSecret ? h("p", { class: "small" }, "Signing secret: ", h("code", {}, s.webhookSecret)) : null,
      h("button", { onclick: guard(async () => {
        await api("/settings", { method: "PUT", body: { org: s.org, palette: s.palette, redactPii: s.redactPii, webhookUrl: hook.value } }); toast("Webhook saved"); renderApp();
      }) }, "Save webhook")),
    h("div", { class: "card" }, h("h2", {}, "REST API"),
      h("p", { class: "muted" }, "Let any tool submit content and receive the report. Submissions appear in the dashboard under “API client”."),
      h("button", { onclick: guard(async () => {
        if (s.apiKeySet && !confirm("This replaces the current API key. Continue?")) return;
        const r = await api("/settings/api-key", { method: "POST" });
        keyOut.replaceChildren(h("p", {}, h("strong", {}, "Your new API key (shown once): "), h("code", {}, r.apiKey)), h("button", { class: "sm", onclick: () => copyText(r.apiKey) }, "Copy"));
      }) }, s.apiKeySet ? "Rotate API key" : "Generate API key"), keyOut,
      h("pre", { class: "card pre small", style: "overflow:auto" }, `curl -X POST ${origin}/api/v1/check \\\n  -H "x-api-key: YOUR_KEY" \\\n  -F title="Fest poster" -F contentType=poster \\\n  -F audience="first-year students" \\\n  -F text="Spectrum Fest 2027 on 14 March..." \\\n  -F files=@poster.png\n\ncurl ${origin}/api/v1/submissions/SUBMISSION_ID -H "x-api-key: YOUR_KEY"`)),
    h("div", { class: "card" }, h("h2", {}, "Your data"),
      h("p", { class: "muted" }, "Download all users, kit, submissions, reports and the audit log as JSON. Managers can delete any submission from its page; creators can delete their own unapproved content."),
      h("a", { class: "btn", href: "/api/export" }, "Export all data")));
};
