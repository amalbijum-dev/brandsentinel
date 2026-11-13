import { hexToRgb, rgbToLab, deltaE2000, contrastRatio, chroma } from "./color.js";

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const BUILTIN = {
  date: new RegExp(
    `\\b\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH})\\b|\\b(?:${MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`,
    "i"
  ),
  time: /\b\d{1,2}(?:[:.]\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/i,
  url: /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|in|org|edu|ac\.in|io|co|net)\b(?:\/\S*)?/i,
  email: /[\w.+-]+@[\w-]+\.[\w.-]+/,
  phone: /(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/
};

export const CHECKLIST_TYPES = ["keyword", "date", "time", "url", "email", "phone"];

/** Required-information check. Pure pattern matching on extracted text, so every result is explainable. */
export function runChecklist(checklist, haystack) {
  const lower = haystack.toLowerCase();
  return checklist.items.map(item => {
    let matched = "";
    const builtin = BUILTIN[item.type];
    if (builtin) {
      const m = haystack.match(builtin);
      if (m) matched = m[0];
    }
    if (!matched) {
      for (const p of String(item.patterns || "").split(",").map(s => s.trim()).filter(Boolean)) {
        if (lower.includes(p.toLowerCase())) {
          matched = p;
          break;
        }
      }
    }
    return { label: item.label, required: item.required !== false, type: item.type, found: Boolean(matched), matched };
  });
}

/** Glossary / banned-wording check. */
export function checkTerms(terms, text) {
  const hits = [];
  for (const term of terms) {
    if (!term.avoid) continue;
    const re = new RegExp(`(?<![\\w])${escapeRe(term.avoid)}(?![\\w])`, "i");
    const m = text.match(re);
    if (m) hits.push({ term, matched: m[0] });
  }
  return hits;
}

const STOP = new Set("the and for with that this from have has are was were will our your you all any can not but its into over more than then also about their they them been being who what when where which while very just only each such".split(" "));

const tokens = s => (String(s).toLowerCase().match(/[a-z0-9₹]+/g) || []).filter(w => w.length > 2 && !STOP.has(w));
const numbers = s => (String(s).match(/\d[\d,]*(?:\.\d+)?/g) || []).map(n => n.replace(/,/g, ""));

/**
 * Non-generative second opinion on a claim: finds the closest approved fact by word overlap and
 * checks that every number in the claim also appears in that fact.
 */
export function secondOpinion(claim, facts) {
  const claimTokens = new Set(tokens(claim));
  if (!claimTokens.size || !facts.length) return { verdict: "no_source", fact_id: "", overlap: 0 };
  let best = null;
  for (const fact of facts) {
    const factTokens = new Set(tokens(fact.text));
    let shared = 0;
    for (const t of claimTokens) if (factTokens.has(t)) shared++;
    const overlap = shared / claimTokens.size;
    if (!best || overlap > best.overlap) best = { fact, overlap };
  }
  if (!best || best.overlap < 0.25) return { verdict: "no_source", fact_id: "", overlap: best?.overlap || 0 };
  const factNums = new Set(numbers(best.fact.text));
  const missing = numbers(claim).filter(n => !factNums.has(n));
  return {
    verdict: missing.length ? "contradicted" : "consistent",
    fact_id: best.fact.id,
    overlap: Math.round(best.overlap * 100) / 100,
    detail: missing.length ? `Claim contains ${missing.join(", ")} which is not in the closest approved fact.` : ""
  };
}

function countSyllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const m = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

/** Flesch reading ease. Returns null for very short text. */
export function readability(text) {
  const words = text.match(/[A-Za-z']+/g) || [];
  if (words.length < 30) return null;
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) || []).length);
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const flesch = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
  const rounded = Math.round(flesch * 10) / 10;
  const band = rounded >= 60 ? "easy to read" : rounded >= 30 ? "moderately difficult" : "very difficult";
  return { words: words.length, flesch: rounded, band };
}

/**
 * Palette and contrast checks from dominant colours measured in the browser (k-means).
 * Contrast between the two most dominant colours is only a proxy for text contrast, so it is reported as an estimate.
 */
export function visualChecks(colors, palette) {
  const issues = [];
  const passed = [];
  const valid = (colors || []).filter(c => /^#[0-9a-f]{6}$/i.test(c.hex) && c.share > 0);
  if (!valid.length) return { issues, passed, palette: [] };

  const paletteLab = (palette || []).filter(p => /^#[0-9a-f]{6}$/i.test(p.hex)).map(p => ({ ...p, lab: rgbToLab(hexToRgb(p.hex)) }));
  const analysed = valid.map(c => {
    let nearest = null;
    for (const p of paletteLab) {
      const d = deltaE2000(rgbToLab(hexToRgb(c.hex)), p.lab);
      if (!nearest || d < nearest.deltaE) nearest = { name: p.name, hex: p.hex, deltaE: Math.round(d * 10) / 10 };
    }
    return { hex: c.hex.toLowerCase(), share: c.share, nearest };
  });

  if (paletteLab.length) {
    const offPalette = analysed.filter(c => c.share >= 0.08 && chroma(c.hex) > 12 && c.nearest && c.nearest.deltaE > 25);
    for (const c of offPalette) {
      issues.push({
        category: "visual",
        severity: "medium",
        certainty: "possible",
        title: `Colour ${c.hex} may be outside the brand palette`,
        description: `A dominant colour (${Math.round(c.share * 100)}% of the image) is ΔE2000 ${c.nearest.deltaE} away from the closest approved colour (${c.nearest.name}, ${c.nearest.hex}). Values above ~25 are usually clearly different. Measured from the rendered image, so photos and gradients can trigger this.`,
        suggestion: `Use ${c.nearest.name} (${c.nearest.hex}) or another approved palette colour, or confirm this colour comes from a photo.`,
        guideline_reference: "Brand palette",
        evidence: c.hex
      });
    }
    if (!offPalette.length) passed.push("Dominant colours are close to the approved palette (ΔE2000 ≤ 25)");
  }

  const sorted = [...analysed].sort((a, b) => b.share - a.share);
  if (sorted.length >= 2) {
    const ratio = Math.round(contrastRatio(sorted[0].hex, sorted[1].hex) * 100) / 100;
    if (ratio < 3) {
      issues.push({
        category: "accessibility",
        severity: "medium",
        certainty: "possible",
        title: "Low contrast between the two most dominant colours",
        description: `The two largest colour areas (${sorted[0].hex}, ${sorted[1].hex}) have a contrast ratio of ${ratio}:1. WCAG 2.2 requires 4.5:1 for body text and 3:1 for large text and UI graphics. This is an estimate from dominant colours, not a measurement of the actual text.`,
        suggestion: "Check the text colour against its background with a contrast checker and increase the difference if it is below 4.5:1 (3:1 for large text).",
        guideline_reference: "WCAG 2.2 SC 1.4.3 / 1.4.11",
        evidence: `${sorted[0].hex} vs ${sorted[1].hex}`
      });
    } else {
      passed.push(`Contrast between dominant colours is ${ratio}:1 (estimate)`);
    }
  }
  return { issues, passed, palette: analysed };
}
