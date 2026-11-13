import crypto from "node:crypto";
import { db } from "./store.js";

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `s1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const [version, saltHex, hashHex] = String(stored || "").split("$");
  if (version !== "s1" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sign = payload => crypto.createHmac("sha256", db.settings.sessionSecret).update(payload).digest("base64url");

export function signToken(userId, hours = 12) {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + hours * 3600e3 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return e > Date.now() ? u : null;
  } catch {
    return null;
  }
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const sha256 = value => crypto.createHash("sha256").update(String(value)).digest("hex");

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
