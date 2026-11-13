import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const FILE = path.join(DATA_DIR, "db.json");

const defaults = () => ({
  users: [],
  guidelines: [],
  checklists: [],
  terms: [],
  facts: [],
  logos: [],
  submissions: [],
  audit: [],
  notifications: [],
  settings: {
    org: "My Organisation",
    palette: [],
    redactPii: true,
    webhookUrl: "",
    webhookSecret: "",
    apiKeyHash: "",
    sessionSecret: crypto.randomBytes(32).toString("hex")
  }
});

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const base = defaults();
    return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}) } };
  } catch {
    return defaults();
  }
}

export const db = load();

/** Atomic write so a crash cannot leave a half-written database. */
export function save() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // folder may have been removed while running
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

export const uid = (prefix = "") => prefix + crypto.randomBytes(6).toString("hex");

export function audit(actor, action, target = "", detail = "") {
  db.audit.push({
    id: uid("a_"),
    at: new Date().toISOString(),
    userId: actor?.id || null,
    userName: actor?.name || "system",
    role: actor?.role || "",
    action,
    target,
    detail: String(detail).slice(0, 500)
  });
  if (db.audit.length > 5000) db.audit.splice(0, db.audit.length - 5000);
}

export function notify(target, text, submissionId = "") {
  // target: a user id, or a role name ("manager" / "reviewer") to notify everyone with that role
  const recipients = db.users.filter(u => u.active !== false && (u.id === target || u.role === target));
  for (const u of recipients) {
    db.notifications.push({ id: uid("n_"), userId: u.id, text, submissionId, at: new Date().toISOString(), read: false });
  }
  if (db.notifications.length > 3000) db.notifications.splice(0, db.notifications.length - 3000);
}
