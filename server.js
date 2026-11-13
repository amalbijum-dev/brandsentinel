import "dotenv/config"; // must be first: lib modules read process.env when they are imported
import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z, ZodError } from "zod";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, save, uid, audit, notify, UPLOAD_DIR } from "./lib/store.js";
import { hashPassword, verifyPassword, signToken, readToken, parseCookies, sha256, safeEqual } from "./lib/auth.js";
import { analyze, transcribeDocument, ai, aiAvailable, GEMINI_MODEL } from "./lib/analyze.js";
import { CHECKLIST_TYPES } from "./lib/checks.js";
import { analyzeVideo, analyzeAudio } from "./lib/video.js";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 5000);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 12);
const MAX_TOTAL_BYTES = 18 * 1024 * 1024; // Gemini inline request limit is ~20 MB
const ROLES = ["creator", "employee", "reviewer", "manager"];
const CONTENT_TYPES = ["poster", "social_post", "reel", "document", "ad", "other"];
const EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "application/pdf": ".pdf", "text/plain": ".txt" };

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, message) => Object.assign(new Error(message), { status });

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "blob:"],
      "media-src": ["'self'", "blob:"],
      "frame-src": ["'self'"],
      "object-src": ["'self'"],
      "connect-src": ["'self'"]
    }
  }
}));
app.use(express.json({ limit: "1mb" }));

const allowedOrigins = (process.env.FRONTEND_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
app.use(express.static(path.join(__dirname, "public")));

// ---------- Authentication ----------
app.use((req, res, next) => {
  req.user = null;
  const key = req.get("x-api-key");
  if (key) {
    if (db.settings.apiKeyHash && safeEqual(sha256(key), db.settings.apiKeyHash)) {
      req.user = { id: "api", name: "API client", role: "creator", api: true };
    }
    return next();
  }
  const userId = readToken(parseCookies(req.headers.cookie).bs_token);
  if (userId) {
    const user = db.users.find(u => u.id === userId && u.active !== false);
    if (user) req.user = user;
  }
  // CSRF defence: cookie sessions must send a custom header on state-changing requests (SameSite=Strict is the first layer).
  if (req.user && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("x-requested-with") !== "brandsentinel") {
    return res.status(403).json({ error: "Missing CSRF header." });
  }
  next();
});

const requireAuth = (req, res, next) => {
  if (!req.user || req.user.api) return res.status(401).json({ error: "Please sign in." });
  next();
};
const requireApi = (req, res, next) => {
  if (!req.user?.api) return res.status(401).json({ error: "A valid x-api-key header is required." });
  next();
};
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) return res.status(403).json({ error: "You do not have permission to do that." });
  next();
};

const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active !== false, createdAt: u.createdAt, demo: Boolean(u.demo) });

// ---------- Demo accounts (for hackathon reviewers) ----------
// One-click sign-in as a demo Manager or Employee. Turn off with DEMO_MODE=false in .env.
const DEMO_MODE = String(process.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
const DEMO_USERS = {
  manager: { name: "Demo Manager", email: "demo.manager@brandsentinel.app", role: "manager" },
  employee: { name: "Demo Employee", email: "demo.employee@brandsentinel.app", role: "creator" }
};
// Blocks actions that would let one reviewer break the shared demo for the next one.
const blockDemo = (req, _res, next) => (req.user && req.user.demo
  ? next(httpError(403, "This is disabled for demo accounts so the shared demo stays usable for everyone. Create your own account to try it."))
  : next());

const limiterBase = { standardHeaders: "draft-7", legacyHeaders: false };
const analyzeLimiter = rateLimit({ ...limiterBase, windowMs: 60_000, limit: 8, message: { error: "Too many analysis requests. Please wait a minute and try again." } });
const loginLimiter = rateLimit({ ...limiterBase, windowMs: 15 * 60_000, limit: 15, message: { error: "Too many sign-in attempts. Try again in a few minutes." } });

const fileFilter = allowed => (_req, file, cb) =>
  allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error("Unsupported file type. Use PNG, JPG, WEBP or PDF."));
const MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 9 }, fileFilter: fileFilter(MEDIA_TYPES) });
// "New check" upload: images/PDFs in "files", plus the original video in "video" so its audio can be reviewed.
const SUB_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const subUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_VIDEO_MB || 60) * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "video") return SUB_VIDEO_TYPES.includes(file.mimetype) ? cb(null, true) : cb(new Error("Unsupported video. Use MP4, MOV or WEBM."));
    return fileFilter(MEDIA_TYPES)(req, file, cb);
  }
}).fields([{ name: "files", maxCount: 9 }, { name: "video", maxCount: 1 }]);
const splitUpload = req => {
  const files = (req.files && req.files.files) || [];
  const video = (req.files && req.files.video && req.files.video[0]) || null;
  const tooBig = files.find(f => f.size > MAX_FILE_MB * 1024 * 1024);
  if (tooBig) throw httpError(413, `"${tooBig.originalname}" is larger than ${MAX_FILE_MB} MB.`);
  return { files, video };
};
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 }, fileFilter: fileFilter([...MEDIA_TYPES, "text/plain", "text/markdown"]) });
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 }, fileFilter: fileFilter(["image/png", "image/jpeg", "image/webp"]) });

// ---------- Health & session ----------
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "BrandSentinel API",
    ai_configured: aiAvailable(),
    gemini_key_configured: Boolean(ai),
    model: GEMINI_MODEL,
    max_file_mb: MAX_FILE_MB
  });
});

app.get("/api/session", (req, res) => {
  res.json({
    setupRequired: db.users.length === 0,
    user: req.user && !req.user.api ? publicUser(req.user) : null,
    org: db.settings.org,
    ai_configured: aiAvailable(),
    allowSignup: db.users.length > 0 && db.settings.allowSignup !== false,
    demo: DEMO_MODE
  });
});

// Password rules (shown on the sign-in / sign-up pages too): 8+ characters, at least one letter and one number.
const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters.")
  .max(200, "Password must be 200 characters or fewer.")
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/\d/, "Password must include at least one number.");
const emailSchema = z.string().trim().toLowerCase()
  .min(1, "Enter your email address.")
  .max(120, "Email must be 120 characters or fewer.")
  .email("Enter a valid email address, like name@company.com.");
const credsSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80, "Name must be 80 characters or fewer."),
  email: emailSchema,
  password: passwordSchema
}).refine(b => b.password.toLowerCase() !== b.email, { message: "Password must not be the same as your email.", path: ["password"] });

function startSession(res, user) {
  res.cookie("bs_token", signToken(user.id), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 3600e3
  });
}

app.post("/api/setup", loginLimiter, wrap(async (req, res) => {
  if (db.users.length) throw httpError(403, "Setup is already complete.");
  const body = credsSchema.and(z.object({ org: z.string().trim().max(100).optional() })).parse(req.body);
  const user = { id: uid("u_"), name: body.name, email: body.email, role: "manager", active: true, passwordHash: hashPassword(body.password), createdAt: new Date().toISOString() };
  db.users.push(user);
  if (body.org) db.settings.org = body.org;
  audit(user, "setup", "organisation", db.settings.org);
  save();
  startSession(res, user);
  res.json({ user: publicUser(user) });
}));

// Sign-up: creates either a "manager" or a "creator" (normal employee).
app.post("/api/signup", loginLimiter, wrap(async (req, res) => {
  if (!db.users.length) throw httpError(403, "The organisation is not set up yet. Create the manager account first.");
  if (db.settings.allowSignup === false) throw httpError(403, "Sign-up is turned off. Ask your manager to add you.");
  const body = credsSchema.and(z.object({
    role: z.enum(["manager", "employee", "creator"]).optional()
  })).parse(req.body);
  if (db.users.some(u => u.email === body.email)) throw httpError(409, "An account with that email already exists. Try signing in.");
  const chosenRole = body.role === "manager" ? "manager" : "creator";
  const user = { id: uid("u_"), name: body.name, email: body.email, role: chosenRole, active: true, passwordHash: hashPassword(body.password), createdAt: new Date().toISOString() };
  db.users.push(user);
  audit(user, "user.signup", user.id, user.email);
  notify("manager", `${user.name} (${user.email}) signed up as ${chosenRole === "manager" ? "a manager" : "a normal employee"}.`, user.id);
  save();
  startSession(res, user);
  res.status(201).json({ user: publicUser(user) });
}));

app.post("/api/login", loginLimiter, wrap(async (req, res) => {
  const { email, password, role } = z.object({
    email: emailSchema,
    password: z.string().min(1, "Enter your password."),
    role: z.enum(["manager", "employee", "creator"]).optional()
  }).parse(req.body);
  const user = db.users.find(u => u.email === email && u.active !== false);
  if (!user || !verifyPassword(password, user.passwordHash)) throw httpError(401, "Incorrect email or password. Passwords are case-sensitive. Forgot it? Ask a manager to reset it from the Team page.");
  
  if (role) {
    const isMgr = user.role === "manager";
    const wantsMgr = role === "manager";
    if (wantsMgr && !isMgr) {
      throw httpError(403, "This account is registered as a Normal Employee, not a Manager. Please switch to the Normal Employee login option.");
    }
    if (!wantsMgr && isMgr) {
      throw httpError(403, "This account is registered as a Manager, not a Normal Employee. Please switch to the Manager login option.");
    }
  }
  
  audit(user, "login");
  save();
  startSession(res, user);
  res.json({ user: publicUser(user) });
}));

// Shareable demo link: /demo opens the Manager demo, /demo/employee the Employee demo.
app.get("/demo", (_req, res) => res.redirect(DEMO_MODE ? "/login.html?demo=manager" : "/login.html"));
app.get("/demo/employee", (_req, res) => res.redirect(DEMO_MODE ? "/login.html?demo=employee" : "/login.html"));

// One-click demo sign-in. Creates the demo users (and the demo brand kit) the first time.
app.post("/api/demo-login", loginLimiter, wrap(async (req, res) => {
  if (!DEMO_MODE) throw httpError(404, "Demo accounts are turned off.");
  const { role } = z.object({ role: z.enum(["manager", "employee"]) }).parse(req.body);
  if (!db.users.length && db.settings.org === "My Organisation") db.settings.org = "Northfield College (demo)";
  for (const d of Object.values(DEMO_USERS)) {
    if (!db.users.some(u => u.email === d.email)) {
      db.users.push({ id: uid("u_"), name: d.name, email: d.email, role: d.role, active: true, demo: true,
        passwordHash: hashPassword(crypto.randomBytes(24).toString("hex")), createdAt: new Date().toISOString() });
    }
  }
  const user = db.users.find(u => u.email === DEMO_USERS[role].email);
  user.active = true; user.demo = true; user.role = DEMO_USERS[role].role;
  if (!db.guidelines.length && !db.checklists.length) loadDemoKit(user);
  audit(user, "login.demo");
  save();
  startSession(res, user);
  res.json({ user: publicUser(user) });
}));

app.post("/api/logout", (req, res) => {
  if (req.user) { audit(req.user, "logout"); save(); }
  res.clearCookie("bs_token");
  res.json({ ok: true });
});

// ---------- Team management (manager) ----------
app.get("/api/users", requireAuth, requireRole("manager", "reviewer"), (_req, res) => res.json(db.users.map(publicUser)));

app.post("/api/users", requireAuth, requireRole("manager"), blockDemo, wrap(async (req, res) => {
  const body = credsSchema.and(z.object({ role: z.enum(ROLES) })).parse(req.body);
  if (db.users.some(u => u.email === body.email)) throw httpError(409, "A user with that email already exists.");
  const user = { id: uid("u_"), name: body.name, email: body.email, role: body.role, active: true, passwordHash: hashPassword(body.password), createdAt: new Date().toISOString() };
  db.users.push(user);
  audit(req.user, "user.create", user.id, `${user.email} as ${user.role}`);
  save();
  res.status(201).json(publicUser(user));
}));

app.patch("/api/users/:id", requireAuth, requireRole("manager"), blockDemo, wrap(async (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) throw httpError(404, "User not found.");
  const body = z.object({ role: z.enum(ROLES).optional(), active: z.boolean().optional(), password: passwordSchema.optional() }).parse(req.body);
  const managers = db.users.filter(u => u.role === "manager" && u.active !== false);
  if (user.id === req.user.id && ((body.role && body.role !== "manager") || body.active === false) && managers.length <= 1) {
    throw httpError(400, "You are the only active manager. Create another manager first.");
  }
  if (body.role) user.role = body.role;
  if (typeof body.active === "boolean") user.active = body.active;
  if (body.password) user.passwordHash = hashPassword(body.password);
  audit(req.user, "user.update", user.id, JSON.stringify({ role: body.role, active: body.active, passwordReset: Boolean(body.password) }));
  save();
  res.json(publicUser(user));
}));

app.delete("/api/users/:id", requireAuth, requireRole("manager"), blockDemo, wrap(async (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) throw httpError(404, "User not found.");
  if (user.id === req.user.id) throw httpError(400, "You cannot remove your own account.");
  db.users = db.users.filter(u => u.id !== user.id);
  db.notifications = db.notifications.filter(n => n.userId !== user.id);
  audit(req.user, "user.remove", user.id, user.email);
  save();
  res.json({ ok: true });
}));

// ---------- Brand kit ----------
const collections = {
  guidelines: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(30000) }),
  checklists: z.object({
    name: z.string().trim().min(1).max(80),
    contentType: z.enum(["all", ...CONTENT_TYPES]),
    items: z.array(z.object({
      label: z.string().trim().min(1).max(80),
      type: z.enum(CHECKLIST_TYPES),
      patterns: z.string().max(300).optional().default(""),
      required: z.boolean().optional().default(true)
    })).min(1).max(30)
  }),
  terms: z.object({ avoid: z.string().trim().min(1).max(80), prefer: z.string().trim().max(80).optional().default(""), note: z.string().trim().max(300).optional().default("") }),
  facts: z.object({ text: z.string().trim().min(1).max(500), source: z.string().trim().max(200).optional().default("") })
};

const kitPayload = () => ({
  org: db.settings.org,
  guidelines: db.guidelines,
  checklists: db.checklists,
  terms: db.terms,
  facts: db.facts,
  palette: db.settings.palette,
  logos: db.logos.map(({ id, name, mime, size }) => ({ id, name, mime, size })),
  contentTypes: CONTENT_TYPES
});

app.get("/api/kit", requireAuth, (_req, res) => res.json(kitPayload()));

app.post("/api/kit/guidelines/import", requireAuth, requireRole("manager"), importUpload.single("file"), wrap(async (req, res) => {
  if (!req.file) throw httpError(400, "Choose a file to import.");
  const isText = req.file.mimetype.startsWith("text/");
  const body = isText ? req.file.buffer.toString("utf8") : await transcribeDocument(req.file);
  if (!body.trim()) throw httpError(422, "No text could be read from that file.");
  const item = { id: uid("g_"), title: path.basename(req.file.originalname).slice(0, 120), body: body.slice(0, 30000), imported: true };
  db.guidelines.push(item);
  audit(req.user, "kit.guidelines.import", item.id, item.title);
  save();
  res.status(201).json(item);
}));

app.post("/api/kit/:c", requireAuth, requireRole("manager"), wrap(async (req, res) => {
  const schema = collections[req.params.c];
  if (!schema) throw httpError(404, "Unknown collection.");
  const item = { id: uid(req.params.c[0] + "_"), ...schema.parse(req.body) };
  if (item.items) item.items = item.items.map(i => ({ id: uid("ci_"), ...i }));
  db[req.params.c].push(item);
  audit(req.user, `kit.${req.params.c}.create`, item.id, item.title || item.name || item.avoid || item.text);
  save();
  res.status(201).json(item);
}));

app.put("/api/kit/:c/:id", requireAuth, requireRole("manager"), wrap(async (req, res) => {
  const schema = collections[req.params.c];
  const list = db[req.params.c];
  const idx = schema ? list.findIndex(x => x.id === req.params.id) : -1;
  if (idx < 0) throw httpError(404, "Not found.");
  const next = { id: req.params.id, ...schema.parse(req.body) };
  if (next.items) next.items = next.items.map(i => ({ id: i.id || uid("ci_"), ...i }));
  list[idx] = next;
  audit(req.user, `kit.${req.params.c}.update`, next.id);
  save();
  res.json(next);
}));

app.delete("/api/kit/:c/:id", requireAuth, requireRole("manager"), wrap(async (req, res) => {
  const list = collections[req.params.c] ? db[req.params.c] : null;
  const idx = list ? list.findIndex(x => x.id === req.params.id) : -1;
  if (idx < 0) throw httpError(404, "Not found.");
  list.splice(idx, 1);
  audit(req.user, `kit.${req.params.c}.delete`, req.params.id);
  save();
  res.json({ ok: true });
}));

app.post("/api/logos", requireAuth, requireRole("manager"), logoUpload.single("file"), wrap(async (req, res) => {
  if (!req.file) throw httpError(400, "Choose a logo image.");
  if (db.logos.length >= 3) throw httpError(400, "Up to 3 reference logos are supported. Delete one first.");
  const id = uid("l_");
  const file = `logo_${id}${EXT[req.file.mimetype]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), req.file.buffer);
  const name = String(req.body.name || req.file.originalname).slice(0, 60);
  db.logos.push({ id, name, mime: req.file.mimetype, file, size: req.file.size });
  audit(req.user, "logo.add", id, name);
  save();
  res.status(201).json({ id, name });
}));

app.get("/api/logos/:id/file", requireAuth, (req, res) => {
  const logo = db.logos.find(l => l.id === req.params.id);
  if (!logo) return res.status(404).end();
  res.type(logo.mime).sendFile(path.join(UPLOAD_DIR, logo.file));
});

app.delete("/api/logos/:id", requireAuth, requireRole("manager"), wrap(async (req, res) => {
  const idx = db.logos.findIndex(l => l.id === req.params.id);
  if (idx < 0) throw httpError(404, "Not found.");
  fs.rmSync(path.join(UPLOAD_DIR, db.logos[idx].file), { force: true });
  db.logos.splice(idx, 1);
  audit(req.user, "logo.delete", req.params.id);
  save();
  res.json({ ok: true });
}));

app.post("/api/kit/demo/load", requireAuth, requireRole("manager"), wrap(async (req, res) => {
  loadDemoKit(req.user);
  res.json(kitPayload());
}));

function loadDemoKit(user) {
  const g = (title, body) => ({ id: uid("g_"), title, body });
  db.guidelines.push(
    g("Brand name and voice", "The fest is called \"Spectrum Fest 2027\" (capital S and F, no hyphen). The organiser is Northfield College Student Welfare Office. Voice: friendly, energetic and clear. Write for students aged 17-24. Avoid slang that excludes parents or faculty. Use simple sentences. Do not use superlatives such as \"best ever\" unless an approved fact supports them."),
    g("Required information on promotional material", "Every poster and social post must show: event name, date, start time, venue, registration link, contact number or email. Posters that mention class exemption must state the exemption form name and the approval needed."),
    g("Colours and logo", "Use the approved palette only: Deep Navy #1E2A44, Electric Blue #2F6DF0, Sunrise Amber #F5A524, Soft White #F7F8FC. Keep the official logo clear of other elements. Text must have at least 4.5:1 contrast against its background."),
    g("Claims, prices and disclosure", "Prices, eligibility, prize and attendance claims must match the approved facts. Mark AI-generated imagery or video with the line \"Created with AI assistance\" where it is realistic enough to mislead.")
  );
  const c = (label, type, patterns = "", required = true) => ({ id: uid("ci_"), label, type, patterns, required });
  db.checklists.push(
    { id: uid("c_"), name: "Poster checklist", contentType: "poster", items: [c("Event name", "keyword", "Spectrum Fest"), c("Date", "date"), c("Start time", "time"), c("Venue", "keyword", "auditorium, lawn, block, hall, ground, campus"), c("Registration link", "url"), c("Contact", "phone", "@"), c("Class exemption form details", "keyword", "exemption, CE-2", false)] },
    { id: uid("c_"), name: "Social post checklist", contentType: "social_post", items: [c("Event name", "keyword", "Spectrum Fest"), c("Date", "date"), c("Venue", "keyword", "auditorium, lawn, block, hall, ground, campus"), c("Registration link", "url")] },
    { id: uid("c_"), name: "Reel checklist", contentType: "reel", items: [c("Event name", "keyword", "Spectrum Fest"), c("Date", "date"), c("Venue", "keyword", "auditorium, lawn, block, hall, ground, campus")] }
  );
  const t = (avoid, prefer, note) => ({ id: uid("t_"), avoid, prefer, note });
  db.terms.push(
    t("Spectrum-Fest", "Spectrum Fest", "Brand name has no hyphen."),
    t("SpectrumFest", "Spectrum Fest", "Brand name is two words."),
    t("best fest ever", "", "Superlatives need an approved supporting fact."),
    t("free entry for all", "free registration for Northfield students", "Entry is not free for external participants.")
  );
  const f = text => ({ id: uid("f_"), text, source: "Demo kit (fictional)" });
  db.facts.push(
    f("Spectrum Fest 2027 takes place on 14, 15 and 16 March 2027 at the Main Auditorium and Central Lawn, Northfield College."),
    f("Registration is free for Northfield College students and costs ₹200 for external participants."),
    f("Spectrum Fest 2027 has 40 events across technical, cultural and sports categories."),
    f("Class exemption for registered volunteers requires Form CE-2 approved by the head of department.")
  );
  db.settings.palette = [
    { name: "Deep Navy", hex: "#1e2a44" }, { name: "Electric Blue", hex: "#2f6df0" },
    { name: "Sunrise Amber", hex: "#f5a524" }, { name: "Soft White", hex: "#f7f8fc" }
  ];
  db.settings.org = db.settings.org === "My Organisation" ? "Northfield College (demo)" : db.settings.org;
  audit(user, "kit.demo.load");
  save();
}

// ---------- Settings & integrations ----------
const settingsPayload = () => ({
  org: db.settings.org,
  palette: db.settings.palette,
  redactPii: db.settings.redactPii,
  allowSignup: db.settings.allowSignup !== false,
  webhookUrl: db.settings.webhookUrl,
  webhookSecret: db.settings.webhookSecret,
  apiKeySet: Boolean(db.settings.apiKeyHash)
});

app.get("/api/settings", requireAuth, requireRole("manager"), (_req, res) => res.json(settingsPayload()));

app.put("/api/settings", requireAuth, requireRole("manager"), blockDemo, wrap(async (req, res) => {
  const body = z.object({
    org: z.string().trim().min(1).max(100),
    palette: z.array(z.object({ name: z.string().trim().min(1).max(40), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colours must look like #1E2A44") })).max(20),
    redactPii: z.boolean(),
    allowSignup: z.boolean().optional(),
    webhookUrl: z.string().trim().max(300).refine(v => !v || /^https?:\/\//i.test(v), "Webhook URL must start with http:// or https://")
  }).parse(req.body);
  db.settings.org = body.org;
  db.settings.palette = body.palette.map(p => ({ name: p.name, hex: p.hex.toLowerCase() }));
  db.settings.redactPii = body.redactPii;
  if (typeof body.allowSignup === "boolean") db.settings.allowSignup = body.allowSignup;
  db.settings.webhookUrl = body.webhookUrl;
  if (body.webhookUrl && !db.settings.webhookSecret) db.settings.webhookSecret = crypto.randomBytes(24).toString("hex");
  audit(req.user, "settings.update");
  save();
  res.json(settingsPayload());
}));

app.post("/api/settings/api-key", requireAuth, requireRole("manager"), blockDemo, (req, res) => {
  const key = "bs_" + crypto.randomBytes(24).toString("hex");
  db.settings.apiKeyHash = sha256(key);
  audit(req.user, "settings.apikey.rotate");
  save();
  res.json({ apiKey: key, note: "Copy it now. It is stored only as a hash and cannot be shown again." });
});

async function fireWebhook(event, payload) {
  const url = db.settings.webhookUrl;
  if (!url) return;
  const body = JSON.stringify({ event, at: new Date().toISOString(), data: payload });
  const signature = crypto.createHmac("sha256", db.settings.webhookSecret || "").update(body).digest("hex");
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-brandsentinel-event": event, "x-brandsentinel-signature": `sha256=${signature}` },
      body,
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    console.warn("Webhook delivery failed:", e.message);
  }
}

// ---------- Submissions ----------
const inputSchema = z.object({
  title: z.string().trim().min(1, "Give the content a title.").max(120),
  contentType: z.enum(CONTENT_TYPES),
  audience: z.string().trim().max(200).optional().default(""),
  text: z.string().max(20000).optional().default(""),
  altText: z.string().max(500).optional().default(""),
  videoMeta: z.string().optional(),
  visual: z.string().optional(),
  keepFiles: z.string().optional()
});

const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

function parseVideoMeta(raw) {
  const m = parseJson(raw, null);
  if (!m || typeof m !== "object") return null;
  const times = Array.isArray(m.frameTimes) ? m.frameTimes.map(Number).filter(Number.isFinite).slice(0, 9) : [];
  return { name: String(m.name || "video").slice(0, 120), duration: Number(m.duration) || 0, frameTimes: times };
}

function parseColors(raw) {
  const list = parseJson(raw, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter(c => c && /^#[0-9a-f]{6}$/i.test(c.hex) && Number(c.share) > 0 && Number(c.share) <= 1)
    .slice(0, 8)
    .map(c => ({ hex: c.hex.toLowerCase(), share: Number(c.share) }));
}

function loadKit() {
  const logos = [];
  for (const l of db.logos.slice(0, 3)) {
    try { logos.push({ name: l.name, mime: l.mime, buffer: fs.readFileSync(path.join(UPLOAD_DIR, l.file)) }); } catch { /* skip missing */ }
  }
  return { guidelines: db.guidelines, checklists: db.checklists, terms: db.terms, facts: db.facts, logos };
}

function readStoredFiles(version) {
  return version.files.map(f => ({ buffer: fs.readFileSync(path.join(UPLOAD_DIR, f.file)), mimetype: f.mime, originalname: f.name, size: f.size }));
}

// Listens to a video's soundtrack and folds the findings into the keyframe report.
async function addAudioReview(report, { videoPath, mime, meta, kit }) {
  report.limitations = (report.limitations || []).filter(l => !/Audio, motion and captions were not analysed/.test(l));
  if (!videoPath) return report;
  if (!ai) {
    report.limitations.push("Audio was not analysed: a Gemini API key is needed for audio review.");
    return report;
  }
  try {
    const models = [GEMINI_MODEL, ...(process.env.GEMINI_FALLBACK_MODELS || "").split(",").map(s => s.trim()).filter(Boolean)];
    const a = await analyzeAudio({ ai, models, filePath: videoPath, mimeType: mime, kit, meta });
    const added = a.issues.map(i => ({
      id: uid("i_"), source: "ai", certainty: "possible", suggested_text: "",
      severity: i.severity, category: i.category === "video" ? "audio" : i.category,
      title: `${i.timestamp ? `[${i.timestamp}] ` : ""}${i.title}`,
      description: i.description, suggestion: i.suggestion,
      evidence: i.quote ? `Heard in audio: "${i.quote}"` : "",
      guideline_reference: i.guideline_reference || ""
    }));
    report.issues = [...report.issues, ...added];
    const order = { high: 0, medium: 1, low: 2 };
    report.issues.sort((x, y) => order[x.severity] - order[y.severity]);
    report.audio = { summary: a.summary, has_speech: a.has_speech, transcript: a.transcript, model: a.model };
    if (!a.has_speech) report.passed_checks = [...(report.passed_checks || []), "Audio reviewed: no speech detected"];
    else if (!added.length) report.passed_checks = [...(report.passed_checks || []), "Audio reviewed: no problems found in the speech or sound"];
    report.limitations.push("Video was reviewed through sampled keyframes (visuals) plus the full audio track (speech and sound). Motion between keyframes was not analysed.");
    const c = { high: 0, medium: 0, low: 0 };
    report.issues.forEach(i => c[i.severity]++);
    report.summary = String(report.summary || "").replace(/\(\d+ high, \d+ medium, \d+ low\)$/, `(${c.high} high, ${c.medium} medium, ${c.low} low)`);
    if (report.issues.some(i => i.severity !== "low")) report.status = "needs_review";
  } catch (e) {
    report.limitations.push(`Audio could not be analysed this time: ${String(e.message || e).slice(0, 160)}`);
  }
  return report;
}

async function buildVersion({ sub, n, user, input, files, previous, video = null }) {
  const keep = !files.length && input.keepFiles === "1" && previous;
  const useFiles = keep ? readStoredFiles(previous) : files;
  const total = useFiles.reduce((a, f) => a + f.size, 0);
  if (total > MAX_TOTAL_BYTES) throw httpError(413, "Attachments are too large in total (limit about 18 MB).");
  if (!input.text.trim() && !useFiles.length) throw httpError(400, "Add some text or upload a file to check.");

  const videoMeta = keep ? previous.videoMeta : parseVideoMeta(input.videoMeta);
  const visualColors = keep && !input.visual ? previous.visualColors : parseColors(input.visual);
  const kit = loadKit();
  const report = await analyze({
    text: input.text,
    files: useFiles,
    meta: { title: sub.title, contentType: sub.contentType, audience: input.audience, altText: input.altText },
    kit,
    settings: db.settings,
    videoMeta,
    visualColors
  });

  // Keep the original video so its audio can be reviewed now and on re-analysis.
  let videoFile = null;
  if (video && videoMeta) {
    videoFile = { file: `${sub.id}_v${n}_video${{ "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm" }[video.mimetype] || ""}`, mime: video.mimetype, size: video.size };
    fs.writeFileSync(path.join(UPLOAD_DIR, videoFile.file), video.buffer);
  } else if (keep && previous.videoFile) {
    videoFile = previous.videoFile;
  }
  if (videoMeta) await addAudioReview(report, { videoPath: videoFile ? path.join(UPLOAD_DIR, videoFile.file) : null, mime: videoFile?.mime, meta: { contentType: sub.contentType, audience: input.audience }, kit });

  const stored = useFiles.map((f, i) => {
    const file = `${sub.id}_v${n}_${i}${EXT[f.mimetype] || ""}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, file), f.buffer);
    return { name: path.basename(f.originalname).slice(0, 120), mime: f.mimetype, file, size: f.size };
  });

  return { n, at: new Date().toISOString(), by: user.id, byName: user.name, text: input.text, altText: input.altText, audience: input.audience, videoMeta, visualColors, videoFile, files: stored, report, decisions: {} };
}

const latest = sub => sub.versions[sub.versions.length - 1];
const canView = (user, sub) => ["manager", "reviewer"].includes(user.role) || sub.ownerId === user.id;
const isOwner = (user, sub) => sub.ownerId === user.id;

function listItem(sub) {
  const v = latest(sub);
  const counts = { high: 0, medium: 0, low: 0 };
  v.report.issues.forEach(i => counts[i.severity]++);
  return {
    id: sub.id, title: sub.title, contentType: sub.contentType, status: sub.status, ownerName: sub.ownerName,
    createdAt: sub.createdAt, updatedAt: sub.updatedAt, version: v.n, counts, sensitive: v.report.sensitive.required, engine: v.report.engine
  };
}

function detail(sub) {
  return {
    ...listItem(sub),
    audience: sub.audience,
    ownerId: sub.ownerId,
    comments: sub.comments,
    timeline: sub.timeline,
    versions: sub.versions.map(v => ({ ...v, files: v.files.map(({ name, mime, size }) => ({ name, mime, size })) }))
  };
}

const addTimeline = (sub, user, action, note = "") => {
  sub.timeline.push({ at: new Date().toISOString(), by: user.name, role: user.role, action, note });
  sub.updatedAt = new Date().toISOString();
};

async function createSubmission(user, body, files, video = null) {
  const input = inputSchema.parse(body);
  const sub = {
    id: uid("s_"), ownerId: user.id, ownerName: user.name, title: input.title, contentType: input.contentType,
    audience: input.audience, status: "ai_checked", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    versions: [], comments: [], timeline: []
  };
  const version = await buildVersion({ sub, n: 1, user, input, files, previous: null, video });
  sub.versions.push(version);
  addTimeline(sub, user, "created", `Version 1 checked (${version.report.engine})`);
  db.submissions.push(sub);
  audit(user, "submission.create", sub.id, sub.title);
  save();
  fireWebhook("analysis.completed", { id: sub.id, title: sub.title, status: sub.status, report_status: version.report.status });
  return sub;
}

app.post("/api/submissions", requireAuth, requireRole("creator", "manager"), analyzeLimiter, subUpload, wrap(async (req, res) => {
  const { files, video } = splitUpload(req);
  const sub = await createSubmission(req.user, req.body, files, video);
  res.status(201).json(detail(sub));
}));

app.get("/api/submissions", requireAuth, (req, res) => {
  const subs = db.submissions.filter(s => canView(req.user, s)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(subs.map(listItem));
});

function getSub(req) {
  const sub = db.submissions.find(s => s.id === req.params.id);
  if (!sub || !canView(req.user, sub)) throw httpError(404, "Submission not found.");
  return sub;
}

app.get("/api/submissions/:id", requireAuth, (req, res) => res.json(detail(getSub(req))));

app.get("/api/submissions/:id/versions/:n/files/:i", requireAuth, (req, res) => {
  const sub = getSub(req);
  const v = sub.versions.find(x => x.n === Number(req.params.n));
  const f = v?.files[Number(req.params.i)];
  if (!f) return res.status(404).end();
  res.type(f.mime).set("Content-Disposition", `inline; filename="${encodeURIComponent(f.name)}"`).sendFile(path.join(UPLOAD_DIR, f.file));
});

const editable = sub => ["ai_checked", "changes_requested"].includes(sub.status);

app.post("/api/submissions/:id/revise", requireAuth, analyzeLimiter, upload.array("files", 9), wrap(async (req, res) => {
  const sub = getSub(req);
  if (!isOwner(req.user, sub) && req.user.role !== "manager") throw httpError(403, "Only the creator can revise this content.");
  if (!editable(sub)) throw httpError(409, "This content is in review. Ask the reviewer to return it before revising.");
  const input = inputSchema.parse({ ...req.body, title: sub.title, contentType: sub.contentType });
  const version = await buildVersion({ sub, n: sub.versions.length + 1, user: req.user, input, files: req.files || [], previous: latest(sub) });
  sub.versions.push(version);
  sub.audience = input.audience;
  sub.status = "ai_checked";
  addTimeline(sub, req.user, "revised", `Version ${version.n} checked`);
  audit(req.user, "submission.revise", sub.id, `v${version.n}`);
  save();
  fireWebhook("analysis.completed", { id: sub.id, title: sub.title, status: sub.status, report_status: version.report.status, version: version.n });
  res.json(detail(sub));
}));

app.post("/api/submissions/:id/reanalyse", requireAuth, analyzeLimiter, wrap(async (req, res) => {
  const sub = getSub(req);
  if (!isOwner(req.user, sub) && req.user.role !== "manager") throw httpError(403, "Only the creator can re-run the analysis.");
  if (!editable(sub)) throw httpError(409, "This content is in review and cannot be re-analysed.");
  const v = latest(sub);
  const files = readStoredFiles(v);
  const kit = loadKit();
  v.report = await analyze({
    text: v.text, files, meta: { title: sub.title, contentType: sub.contentType, audience: v.audience, altText: v.altText },
    kit, settings: db.settings, videoMeta: v.videoMeta, visualColors: v.visualColors
  });
  if (v.videoMeta) await addAudioReview(v.report, { videoPath: v.videoFile ? path.join(UPLOAD_DIR, v.videoFile.file) : null, mime: v.videoFile?.mime, meta: { contentType: sub.contentType, audience: v.audience }, kit });
  v.decisions = {};
  addTimeline(sub, req.user, "re-analysed", `Version ${v.n} (${v.report.engine})`);
  audit(req.user, "submission.reanalyse", sub.id);
  save();
  res.json(detail(sub));
}));

app.post("/api/submissions/:id/decisions", requireAuth, wrap(async (req, res) => {
  const sub = getSub(req);
  if (!isOwner(req.user, sub) && req.user.role !== "manager") throw httpError(403, "Only the creator can respond to suggestions.");
  if (!editable(sub)) throw httpError(409, "Decisions are locked while the content is in review.");
  const body = z.object({ issueId: z.string(), decision: z.enum(["accepted", "modified", "rejected", "unclear"]), note: z.string().trim().max(500).optional().default("") }).parse(req.body);
  const v = latest(sub);
  if (!v.report.issues.some(i => i.id === body.issueId)) throw httpError(404, "Issue not found.");
  if (body.decision === "rejected" && !body.note) throw httpError(400, "Add a short reason when rejecting a finding.");
  v.decisions[body.issueId] = { decision: body.decision, note: body.note, by: req.user.name, at: new Date().toISOString() };
  audit(req.user, "issue.decision", sub.id, `${body.issueId}: ${body.decision}`);
  save();
  res.json({ decisions: v.decisions });
}));

app.post("/api/submissions/:id/submit-for-review", requireAuth, wrap(async (req, res) => {
  const sub = getSub(req);
  if (!isOwner(req.user, sub) && req.user.role !== "manager") throw httpError(403, "Only the creator can submit this for review.");
  if (!editable(sub)) throw httpError(409, "Already submitted.");
  const v = latest(sub);
  if (v.report.engine === "rules-only" && aiAvailable()) throw httpError(409, "The AI check did not complete. Use “Re-run analysis” first.");
  const open = v.report.issues.filter(i => i.severity === "high" && !v.decisions[i.id]);
  if (open.length) throw httpError(409, `Respond to the ${open.length} high-severity finding(s) first (accept, modify, reject with a reason, or mark the guideline unclear).`);
  sub.status = v.report.sensitive.required ? "legal_review" : "manager_review";
  addTimeline(sub, req.user, "submitted for review", sub.status === "legal_review" ? `Legal/compliance review needed: ${v.report.sensitive.reasons.join("; ")}` : "Sent to manager for final check");
  notify(sub.status === "legal_review" ? "reviewer" : "manager", `"${sub.title}" is waiting for ${sub.status === "legal_review" ? "legal review" : "final approval"}.`, sub.id);
  audit(req.user, "submission.submit", sub.id, sub.status);
  save();
  fireWebhook("submission.status_changed", { id: sub.id, title: sub.title, status: sub.status });
  res.json(detail(sub));
}));

// Manager perk: check problem issues and give direct replies
app.post("/api/submissions/:id/issues/:issueId/reply", requireAuth, requireRole("manager"), wrap(async (req, res) => {
  const sub = getSub(req);
  const { reply } = z.object({ reply: z.string().trim().min(1, "Enter a reply.").max(1000) }).parse(req.body);
  const v = latest(sub);
  if (!v.report.issues.some(i => i.id === req.params.issueId)) throw httpError(404, "Issue not found.");
  const existing = v.decisions[req.params.issueId] || {};
  v.decisions[req.params.issueId] = {
    ...existing,
    managerReply: reply,
    managerReplyBy: req.user.name,
    managerReplyAt: new Date().toISOString()
  };
  sub.updatedAt = new Date().toISOString();
  addTimeline(sub, req.user, "replied to problem", `Issue ${req.params.issueId}: ${reply.slice(0, 80)}`);
  notify(sub.ownerId, `${req.user.name} (Manager) replied to a problem in "${sub.title}": ${reply.slice(0, 100)}`, sub.id);
  audit(req.user, "issue.managerReply", sub.id, `${req.params.issueId}: ${reply.slice(0, 80)}`);
  save();
  res.json({ decisions: v.decisions });
}));

// Manager perk: approve or disapprove (return with feedback) submissions
app.post("/api/submissions/:id/review", requireAuth, requireRole("reviewer", "manager"), wrap(async (req, res) => {
  const sub = getSub(req);
  const body = z.object({
    action: z.enum(["approve", "disapprove", "return"]),
    comment: z.string().trim().max(1000).optional().default("")
  }).parse(req.body);
  const action = body.action === "disapprove" ? "return" : body.action;

  if (sub.status === "manager_review" && req.user.role !== "manager") throw httpError(403, "Only a manager can give the final approval.");
  
  if (req.user.role === "manager") {
    if (["approved", "published"].includes(sub.status) && action !== "return") {
      throw httpError(409, "This content is already approved or published.");
    }
  } else {
    if (!["legal_review", "manager_review"].includes(sub.status)) {
      throw httpError(409, "This content is not waiting for review.");
    }
  }

  if (action === "return" && !body.comment) throw httpError(400, "Add a comment explaining what to change.");
  const stage = sub.status;
  if (action === "return") {
    sub.status = "changes_requested";
    notify(sub.ownerId, `"${sub.title}" was disapproved / changes requested: ${body.comment.slice(0, 120)}`, sub.id);
  } else if (stage === "legal_review" && req.user.role !== "manager") {
    sub.status = "manager_review";
    notify("manager", `"${sub.title}" passed legal review and needs final approval.`, sub.id);
  } else {
    sub.status = "approved";
    notify(sub.ownerId, `"${sub.title}" was approved by ${req.user.name}.`, sub.id);
  }
  if (body.comment) sub.comments.push({ id: uid("c_"), by: req.user.name, role: req.user.role, text: body.comment, at: new Date().toISOString() });
  addTimeline(sub, req.user, action === "approve" ? `approved` : `disapproved (changes requested)`, body.comment);
  audit(req.user, `submission.${action}`, sub.id, stage);
  save();
  fireWebhook("submission.status_changed", { id: sub.id, title: sub.title, status: sub.status });
  res.json(detail(sub));
}));

app.post("/api/submissions/:id/publish", requireAuth, requireRole("manager"), wrap(async (req, res) => {
  const sub = getSub(req);
  if (sub.status !== "approved") throw httpError(409, "Only approved content can be marked as published.");
  sub.status = "published";
  addTimeline(sub, req.user, "marked as published");
  notify(sub.ownerId, `"${sub.title}" is marked as published.`, sub.id);
  audit(req.user, "submission.publish", sub.id);
  save();
  fireWebhook("submission.status_changed", { id: sub.id, title: sub.title, status: sub.status });
  res.json(detail(sub));
}));

app.post("/api/submissions/:id/comments", requireAuth, wrap(async (req, res) => {
  const sub = getSub(req);
  const { text } = z.object({ text: z.string().trim().min(1).max(1000) }).parse(req.body);
  sub.comments.push({ id: uid("c_"), by: req.user.name, role: req.user.role, text, at: new Date().toISOString() });
  sub.updatedAt = new Date().toISOString();
  const target = isOwner(req.user, sub) ? "manager" : sub.ownerId;
  notify(target, `${req.user.name} commented on "${sub.title}".`, sub.id);
  audit(req.user, "submission.comment", sub.id);
  save();
  res.status(201).json(sub.comments);
}));

app.delete("/api/submissions/:id", requireAuth, wrap(async (req, res) => {
  const sub = getSub(req);
  const ownerCanDelete = isOwner(req.user, sub) && !["approved", "published"].includes(sub.status);
  if (!ownerCanDelete && req.user.role !== "manager") throw httpError(403, "You cannot delete this content.");
  for (const v of sub.versions) for (const f of v.files) fs.rmSync(path.join(UPLOAD_DIR, f.file), { force: true });
  db.submissions.splice(db.submissions.indexOf(sub), 1);
  audit(req.user, "submission.delete", sub.id, sub.title);
  save();
  res.json({ ok: true });
}));

// ---------- Insights, audit, notifications, export ----------
app.get("/api/insights", requireAuth, requireRole("manager", "reviewer"), (_req, res) => {
  const byStatus = {}, byCategory = {}, byGuideline = {}, titles = {};
  let totalIssues = 0, resubmissions = 0, approvedCount = 0, approvedVersions = 0;
  for (const s of db.submissions) {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    resubmissions += s.versions.length - 1;
    if (["approved", "published"].includes(s.status)) { approvedCount++; approvedVersions += s.versions.length; }
    for (const v of s.versions) {
      for (const i of v.report.issues) {
        totalIssues++;
        byCategory[i.category] = (byCategory[i.category] || 0) + 1;
        const key = i.title.replace(/["“][^"”]*["”]/g, "…").slice(0, 80);
        titles[key] = (titles[key] || 0) + 1;
        const ref = i.guideline_reference || "Unreferenced";
        const g = (byGuideline[ref] ||= { reference: ref, flagged: 0, accepted: 0, modified: 0, rejected: 0, unclear: 0 });
        g.flagged++;
        const d = v.decisions[i.id]?.decision;
        if (d) g[d]++;
      }
    }
  }
  const guidelines = Object.values(byGuideline)
    .map(g => ({ ...g, confusion: g.unclear * 3 + g.rejected }))
    .sort((a, b) => b.confusion - a.confusion || b.flagged - a.flagged)
    .slice(0, 10);
  res.json({
    totals: { submissions: db.submissions.length, issues: totalIssues, resubmissions, avgVersionsToApproval: approvedCount ? Math.round((approvedVersions / approvedCount) * 10) / 10 : null },
    byStatus,
    byCategory,
    guidelines,
    topIssues: Object.entries(titles).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([title, count]) => ({ title, count }))
  });
});

app.get("/api/audit", requireAuth, requireRole("manager"), (req, res) => {
  const target = String(req.query.target || "");
  const rows = db.audit.filter(a => !target || a.target === target).slice(-300).reverse();
  res.json(rows);
});

app.get("/api/notifications", requireAuth, (req, res) => {
  res.json(db.notifications.filter(n => n.userId === req.user.id).slice(-30).reverse());
});

app.post("/api/notifications/read", requireAuth, (req, res) => {
  db.notifications.forEach(n => { if (n.userId === req.user.id) n.read = true; });
  save();
  res.json({ ok: true });
});

app.get("/api/export", requireAuth, requireRole("manager"), blockDemo, (req, res) => {
  audit(req.user, "data.export");
  save();
  res.set("Content-Disposition", 'attachment; filename="brandsentinel-export.json"').json({
    exportedAt: new Date().toISOString(),
    organisation: db.settings.org,
    users: db.users.map(publicUser),
    kit: kitPayload(),
    submissions: db.submissions.map(detail),
    audit: db.audit
  });
});

// ---------- Public REST API (for other tools) ----------
app.post("/api/v1/check", requireApi, analyzeLimiter, upload.array("files", 9), wrap(async (req, res) => {
  const sub = await createSubmission(req.user, req.body, req.files || []);
  const v = latest(sub);
  res.status(201).json({ id: sub.id, status: sub.status, report: v.report });
}));

app.get("/api/v1/submissions/:id", requireApi, (req, res) => {
  const sub = db.submissions.find(s => s.id === req.params.id && s.ownerId === "api");
  if (!sub) return res.status(404).json({ error: "Not found." });
  res.json({ id: sub.id, status: sub.status, version: latest(sub).n, report: latest(sub).report });
});

// ---------- Full video review (visuals + audio + on-screen text, AI-content signal) ----------
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_VIDEO_MB = Number(process.env.MAX_VIDEO_MB || 60);
const videoUpload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir(), filename: (_r, f, cb) => cb(null, `bs_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`) }),
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024, files: 1 },
  fileFilter: (_r, f, cb) => VIDEO_TYPES.includes(f.mimetype) ? cb(null, true) : cb(new Error("Unsupported video. Use MP4, MOV or WEBM."))
});

app.post("/api/video-check", requireAuth, requireRole("creator", "manager"), analyzeLimiter, videoUpload.single("video"), wrap(async (req, res) => {
  try {
    if (!req.file) throw httpError(400, "Choose a video to check.");
    const meta = z.object({
      contentType: z.enum(CONTENT_TYPES).optional().default("reel"),
      audience: z.string().trim().max(200).optional().default("")
    }).parse(req.body);
    const models = [GEMINI_MODEL, ...(process.env.GEMINI_FALLBACK_MODELS || "").split(",").map(s => s.trim()).filter(Boolean)];
    const report = await analyzeVideo({ ai, models, filePath: req.file.path, mimeType: req.file.mimetype, kit: loadKit(), meta });
    audit(req.user, "video.check", req.file.originalname.slice(0, 80), report.status);
    save();
    res.json({ file: path.basename(req.file.originalname).slice(0, 120), report });
  } finally {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
  }
}));

// Simulated report so the UI can be demonstrated without using API quota.
app.post("/api/demo", requireAuth, (_req, res) => {
  res.json({
    status: "needs_review",
    summary: "Demo report: simulated data, not an AI analysis.",
    issues: [{ severity: "high", title: "Missing: Venue", description: "The poster checklist requires a venue.", suggestion: "Add the approved venue.", guideline_reference: "Required information: Poster checklist → Venue" }],
    passed_checks: ["Event name present"],
    limitations: ["This is simulated demo data."],
    engine: "demo"
  });
});

// ---------- Errors ----------
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

app.use((error, _req, res, _next) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: error.issues.map(i => i.message).join(" ") });
  }
  if (error instanceof multer.MulterError) {
    const msg = error.code === "LIMIT_FILE_SIZE" ? `File too large. Maximum size is ${MAX_FILE_MB} MB.` : error.message;
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: msg });
  }
  const status = Number(error.status) || 400;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: String(error.message || "Request error.").slice(0, 400) });
});

app.listen(PORT, () => {
  console.log(`BrandSentinel running at http://localhost:${PORT}`);
  console.log(`AI: ${aiAvailable() ? `Gemini model ${GEMINI_MODEL}` : "not configured (rule-based checks only)"}`);
  if (!db.users.length) console.log("First run: open the app and create the manager account.");
});
