// Redacts personal identifiers before any text leaves the server for an external AI model.
// Aadhaar and PAN are ALWAYS redacted. Emails and phone numbers are redacted when `redactContacts` is true.
// The deterministic checklist runs locally on the original text, so redaction never breaks "contact" checks.

const RULES = [
  { label: "AADHAAR", re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, always: true },
  { label: "PAN", re: /\b[A-Z]{5}\d{4}[A-Z]\b/g, always: true },
  { label: "EMAIL", re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, always: false },
  { label: "PHONE", re: /(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, always: false }
];

export function redact(input, redactContacts = true) {
  let text = String(input || "");
  const counts = {};
  for (const rule of RULES) {
    if (!rule.always && !redactContacts) continue;
    text = text.replace(rule.re, () => {
      counts[rule.label] = (counts[rule.label] || 0) + 1;
      return `[${rule.label}]`;
    });
  }
  return { text, counts };
}
