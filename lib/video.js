// Full-video review with Gemini (visuals + audio + on-screen text) plus an AI-content signal.
import fs from "node:fs";
import { z } from "zod";

const sleep = ms => new Promise(r => setTimeout(r, ms));

const issueSchema = z.object({
  severity: z.enum(["high", "medium", "low"]).catch("medium"),
  category: z.string().catch("video"),
  title: z.string().max(200),
  description: z.string().catch(""),
  suggestion: z.string().catch(""),
  timestamp: z.string().optional().catch(undefined),
  guideline_reference: z.string().optional().catch("")
});

const num = z.coerce.number().min(0).max(100).catch(70);
const reportSchema = z.object({
  summary: z.string().catch(""),
  scores: z.object({ brand_voice: num, messaging_accuracy: num, visual_identity: num, audio_clarity: num, accessibility: num, hook_strength: num })
    .catch({ brand_voice: 70, messaging_accuracy: 70, visual_identity: 70, audio_clarity: 70, accessibility: 70, hook_strength: 70 }),
  timeline: z.array(z.object({ start: z.string().catch("00:00"), end: z.string().catch(""), label: z.string().catch(""), note: z.string().catch("") })).catch([]),
  transcript: z.array(z.object({ time: z.string().catch(""), text: z.string().catch("") })).catch([]),
  claims_checked: z.array(z.object({
    claim: z.string().catch(""), timestamp: z.string().catch(""),
    verdict: z.enum(["supported", "contradicted", "unverified"]).catch("unverified"),
    evidence: z.string().catch("")
  })).catch([]),
  call_to_action: z.object({ present: z.boolean().catch(false), text: z.string().catch(""), note: z.string().catch("") }).catch({ present: false, text: "", note: "" }),
  logo_visible: z.boolean().catch(false),
  suggested_rewrite: z.string().catch(""),
  speech_summary: z.string().catch(""),
  on_screen_text: z.array(z.string()).catch([]),
  issues: z.array(issueSchema).catch([]),
  passed_checks: z.array(z.string()).catch([]),
  ai_signal: z.object({
    likelihood: z.enum(["low", "medium", "high"]).catch("low"),
    signals: z.array(z.string()).catch([]),
    disclosure_present: z.boolean().catch(false)
  }).catch({ likelihood: "low", signals: [], disclosure_present: false }),
  audience_fit: z.object({
    estimated_audience: z.string().catch(""),
    matches: z.boolean().catch(true),
    note: z.string().catch("")
  }).catch({ estimated_audience: "", matches: true, note: "" })
});

const clip = (s, n) => String(s || "").slice(0, n);

function buildPrompt({ kit, meta }) {
  const g = kit.guidelines.map(x => `- ${x.title}: ${clip(x.body, 2500)}`).join("\n") || "(none)";
  const t = kit.terms.map(x => `- avoid "${x.avoid}"${x.prefer ? ` -> use "${x.prefer}"` : ""} ${x.note || ""}`).join("\n") || "(none)";
  const f = kit.facts.map(x => `- ${x.text}`).join("\n") || "(none)";
  const c = kit.checklists
    .filter(x => x.contentType === "all" || x.contentType === meta.contentType)
    .map(x => `${x.name}: ${x.items.filter(i => i.required).map(i => i.label).join(", ")}`).join("\n") || "(none)";
  return `You review a ${meta.contentType} video before publication for an organisation's brand governance tool.
Watch the whole video, listen to the audio, and read every piece of on-screen text.
Intended audience stated by the creator: ${meta.audience || "not stated"}.

BRAND GUIDELINES:\n${g}\n\nWORDING RULES:\n${t}\n\nAPPROVED FACTS (the only source for claims):\n${f}\n\nREQUIRED INFORMATION:\n${c}

Find: spelling/grammar errors in speech or on-screen text; missing required information; claims, dates, prices or numbers that contradict or are not supported by the approved facts; guideline or wording-rule violations; palette/logo/readability problems (small or low-contrast text, text shown too briefly); audio problems (unclear speech, loud music over speech).
Also estimate whether the video looks AI-generated or edited (visual artefacts, unnatural motion, synthetic voice, garbled text) and whether a disclosure such as "Created with AI assistance" is shown. This is a weak signal, never proof.
Give a timestamp (mm:ss) for each issue. Only cite guidelines/facts given above; use "" if none applies. Do not invent problems; if unsure, use severity "low" and say so.

Also: (1) score each dimension 0-100 (brand_voice, messaging_accuracy, visual_identity, audio_clarity, accessibility incl. captions/contrast/readable duration, hook_strength of the first 3 seconds); be strict and consistent, 100 means no issues. (2) Build a scene timeline (start/end mm:ss, short label, one-line note). (3) Transcribe speech in short timestamped segments. (4) List EVERY factual claim, price, date, number or promise and give a verdict against the approved facts: "supported" only if an approved fact backs it, "contradicted" if it conflicts, else "unverified" (quote the fact as evidence). (5) Say whether a call to action and the logo are present. (6) Give a short suggested_rewrite of the voice-over/caption script that fixes the issues and stays on brand.
Return ONLY JSON: {"summary":str,"scores":{"brand_voice":int,"messaging_accuracy":int,"visual_identity":int,"audio_clarity":int,"accessibility":int,"hook_strength":int},"timeline":[{"start":"mm:ss","end":"mm:ss","label":str,"note":str}],"transcript":[{"time":"mm:ss","text":str}],"claims_checked":[{"claim":str,"timestamp":"mm:ss","verdict":"supported|contradicted|unverified","evidence":str}],"call_to_action":{"present":bool,"text":str,"note":str},"logo_visible":bool,"suggested_rewrite":str,"speech_summary":str,"on_screen_text":[str],"issues":[{"severity":"high|medium|low","category":"spelling|missing_info|claim|guideline|visual|audio|accessibility|ai_disclosure|audience","title":str,"description":str,"suggestion":str,"timestamp":"mm:ss","guideline_reference":str}],"passed_checks":[str],"ai_signal":{"likelihood":"low|medium|high","signals":[str],"disclosure_present":bool},"audience_fit":{"estimated_audience":str,"matches":bool,"note":str}}`;
}

const parseJson = text => {
  const cleaned = String(text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
};

// Deterministic second check: wording rules on text the model read/heard.
function termIssues(report, terms) {
  const hay = [...report.on_screen_text, report.speech_summary].join("\n").toLowerCase();
  return terms.filter(t => t.avoid && hay.includes(t.avoid.toLowerCase())).map(t => ({
    severity: "medium", category: "guideline",
    title: `Wording rule: avoid "${t.avoid}"`,
    description: t.note || "This wording is on the avoid list.",
    suggestion: t.prefer ? `Use "${t.prefer}" instead.` : "Remove or rephrase.",
    guideline_reference: `Wording rules: ${t.avoid}`
  }));
}

export async function analyzeVideo({ ai, models, filePath, mimeType, kit, meta }) {
  if (!ai) throw Object.assign(new Error("Video analysis needs a Gemini API key."), { status: 503 });
  let uploaded;
  try {
    uploaded = await ai.files.upload({ file: filePath, config: { mimeType } });
    for (let i = 0; i < 60 && uploaded.state !== "ACTIVE"; i++) {
      if (uploaded.state === "FAILED") throw Object.assign(new Error("The video could not be processed. Try an MP4 file."), { status: 422 });
      await sleep(2000);
      uploaded = await ai.files.get({ name: uploaded.name });
    }
    if (uploaded.state !== "ACTIVE") throw Object.assign(new Error("Video processing timed out. Try a shorter clip."), { status: 504 });

    const prompt = buildPrompt({ kit, meta });
    let raw, usedModel, lastErr;
    for (const model of models) {
      try {
        const out = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType || mimeType } }, { text: prompt }] }],
          config: { responseMimeType: "application/json", temperature: 0.1 }
        });
        raw = parseJson(out.text);
        usedModel = model;
        break;
      } catch (e) { lastErr = e; }
    }
    if (!raw) throw Object.assign(new Error(`Video analysis failed: ${clip(lastErr?.message, 200)}`), { status: 502 });

    const r = reportSchema.parse(raw);
    const issues = [...r.issues, ...termIssues(r, kit.terms)];
    if (r.ai_signal.likelihood !== "low" && !r.ai_signal.disclosure_present) {
      issues.push({
        severity: "medium", category: "ai_disclosure",
        title: "Possible AI-generated video without a disclosure",
        description: "The video shows signs of being AI-generated or heavily edited and no disclosure line was found. This is a weak signal, not proof.",
        suggestion: 'Confirm how it was made. If AI-generated, add "Created with AI assistance".',
        guideline_reference: "Claims, prices and disclosure"
      });
    }
    if (!r.audience_fit.matches && meta.audience) {
      issues.push({
        severity: "low", category: "audience",
        title: "Video may not suit the stated audience",
        description: `Estimated audience: ${r.audience_fit.estimated_audience}. ${r.audience_fit.note}`,
        suggestion: "Adjust tone, language or visuals, or update the intended audience.",
        guideline_reference: ""
      });
    }
    // Non-generative second opinion: claims the model could not ground, and numbers not present in the approved facts.
    const factText = kit.facts.map(x => x.text).join(" ").toLowerCase();
    for (const c of r.claims_checked) {
      if (c.verdict === "contradicted") issues.push({ severity: "high", category: "claim", title: `Claim contradicts approved facts: "${clip(c.claim, 90)}"`, description: c.evidence || "Conflicts with a stored approved fact.", suggestion: "Correct it to match the approved fact or remove the claim.", timestamp: c.timestamp, guideline_reference: "Approved facts" });
      else if (c.verdict === "unverified") issues.push({ severity: "low", category: "claim", title: `Needs human verification: "${clip(c.claim, 90)}"`, description: "No approved fact supports this claim, so it is not asserted as correct or wrong.", suggestion: "Add a source to the fact base or remove the claim.", timestamp: c.timestamp, guideline_reference: "" });
    }
    const spoken = [...r.on_screen_text, ...r.transcript.map(t => t.text)].join(" ");
    const nums = [...new Set((spoken.match(/\d[\d,.:]*\d|\d/g) || []).filter(n => n.replace(/\D/g, "").length >= 2))];
    const stray = nums.filter(n => !factText.includes(n.toLowerCase())).slice(0, 4);
    if (stray.length && kit.facts.length) issues.push({ severity: "low", category: "claim", title: `Numbers not found in the approved facts: ${stray.join(", ")}`, description: "Deterministic check: these figures appear in the video but in no approved fact.", suggestion: "Confirm each figure against its source before publishing.", guideline_reference: "Approved facts" });
    if (!r.call_to_action.present) issues.push({ severity: "low", category: "guideline", title: "No clear call to action", description: r.call_to_action.note || "The video ends without telling viewers what to do next.", suggestion: "End with one clear action, e.g. a link, date or sign-up line." });
    if (!r.logo_visible) issues.push({ severity: "low", category: "visual", title: "Brand logo not visible", description: "No logo or brand mark was detected on screen.", suggestion: "Show the approved logo, e.g. in the opening or closing frame." });

    const withIds = issues.map((i, n) => ({ id: `v${n + 1}`, ...i }));
    const sevW = { high: 12, medium: 5, low: 2 };
    const penalty = withIds.reduce((a, i) => a + (sevW[i.severity] || 0), 0);
    const dims = Object.values(r.scores);
    const dimAvg = dims.reduce((a, b) => a + b, 0) / dims.length;
    const overall = Math.max(0, Math.min(100, Math.round(dimAvg * 0.6 + Math.max(0, 100 - penalty) * 0.4)));
    const order = { high: 0, medium: 1, low: 2 };
    withIds.sort((a, b) => order[a.severity] - order[b.severity]);
    return {
      overall_score: overall,
      verdict: overall >= 85 && !withIds.some(i => i.severity === "high") ? "Ready to publish" : overall >= 60 ? "Fix before publishing" : "Major rework needed",
      scores: r.scores, timeline: r.timeline, transcript: r.transcript, claims_checked: r.claims_checked,
      call_to_action: r.call_to_action, logo_visible: r.logo_visible, suggested_rewrite: r.suggested_rewrite,
      top_fixes: withIds.filter(i => i.severity !== "low").slice(0, 3).map(i => i.suggestion).filter(Boolean),
      status: withIds.some(i => i.severity === "high") ? "needs_review" : withIds.length ? "minor_issues" : "looks_good",
      summary: r.summary,
      speech_summary: r.speech_summary,
      on_screen_text: r.on_screen_text,
      issues: withIds,
      passed_checks: r.passed_checks,
      ai_signal: r.ai_signal,
      audience_fit: r.audience_fit,
      limitations: [
        "AI review of video can miss issues or flag false ones; every finding is a suggestion for a human to decide.",
        "The AI-content signal is weak and is not proof of how the video was made.",
        "Personal data spoken or shown in a video cannot be redacted before analysis."
      ],
      engine: `gemini-video (${usedModel})`
    };
  } finally {
    if (uploaded?.name) ai.files.delete({ name: uploaded.name }).catch(() => {});
  }
}

// ---------- Audio review for videos uploaded through "New check" ----------
// Keyframes cover the visuals; this listens to the soundtrack (speech, voice-over, music) of the same video.
const audioSchema = z.object({
  summary: z.string().catch(""),
  has_speech: z.boolean().catch(false),
  transcript: z.array(z.object({ time: z.string().catch(""), text: z.string().catch("") })).catch([]),
  issues: z.array(issueSchema.extend({ quote: z.string().optional().catch("") })).catch([])
});

function buildAudioPrompt({ kit, meta }) {
  const g = kit.guidelines.map(x => `- ${x.title}: ${clip(x.body, 2500)}`).join("\n") || "(none)";
  const t = kit.terms.map(x => `- avoid "${x.avoid}"${x.prefer ? ` -> use "${x.prefer}"` : ""} ${x.note || ""}`).join("\n") || "(none)";
  const f = kit.facts.map(x => `- ${x.text}`).join("\n") || "(none)";
  return `You review the AUDIO track of a ${meta.contentType} video for an organisation's brand governance tool. The visuals are checked separately, so focus only on what can be heard: speech, voice-over, narration, lyrics, music and sound.
Intended audience stated by the creator: ${meta.audience || "not stated"}.

BRAND GUIDELINES:\n${g}\n\nWORDING RULES:\n${t}\n\nAPPROVED FACTS (the only source for claims):\n${f}

1. Transcribe all speech in short timestamped segments (mm:ss). If there is no speech, return an empty transcript and has_speech false.
2. Find audio problems: spoken claims, dates, prices or numbers that contradict or are not supported by the approved facts; wording-rule or guideline violations (tone, banned words, off-brand language); mispronounced brand or event names; unclear or inaudible speech; music or effects drowning out speech; abrupt cuts, distortion or very low/high volume; profanity or content unsuitable for the stated audience.
Give a timestamp (mm:ss) and the exact spoken quote for each issue. Only cite guidelines/facts given above; use "" if none applies. Do not invent problems; if unsure use severity "low".
Return ONLY JSON: {"summary":str,"has_speech":bool,"transcript":[{"time":"mm:ss","text":str}],"issues":[{"severity":"high|medium|low","category":"audio|claim|guideline|spelling|audience|accessibility","title":str,"description":str,"suggestion":str,"timestamp":"mm:ss","quote":str,"guideline_reference":str}]}`;
}

export async function analyzeAudio({ ai, models, filePath, mimeType, kit, meta }) {
  if (!ai) throw new Error("Audio analysis needs a Gemini API key.");
  let uploaded;
  try {
    uploaded = await ai.files.upload({ file: filePath, config: { mimeType } });
    for (let i = 0; i < 60 && uploaded.state !== "ACTIVE"; i++) {
      if (uploaded.state === "FAILED") throw new Error("The video's audio could not be processed.");
      await sleep(2000);
      uploaded = await ai.files.get({ name: uploaded.name });
    }
    if (uploaded.state !== "ACTIVE") throw new Error("Audio processing timed out.");
    const prompt = buildAudioPrompt({ kit, meta });
    let raw, usedModel, lastErr;
    for (const model of models) {
      try {
        const out = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType || mimeType } }, { text: prompt }] }],
          config: { responseMimeType: "application/json", temperature: 0.1 }
        });
        raw = parseJson(out.text); usedModel = model; break;
      } catch (e) { lastErr = e; }
    }
    if (!raw) throw new Error(`Audio analysis failed: ${clip(lastErr?.message, 200)}`);
    const r = audioSchema.parse(raw);
    // deterministic wording check on the transcript
    const said = r.transcript.map(x => x.text).join("\n").toLowerCase();
    const extra = kit.terms.filter(t => t.avoid && said.includes(t.avoid.toLowerCase())).map(t => ({
      severity: "medium", category: "guideline", title: `Spoken wording rule: avoid "${t.avoid}"`,
      description: t.note || "This wording is on the avoid list and is spoken in the video.",
      suggestion: t.prefer ? `Say "${t.prefer}" instead.` : "Remove or rephrase it in the voice-over.",
      timestamp: "", quote: t.avoid, guideline_reference: `Wording rules: ${t.avoid}`
    }));
    return { ...r, issues: [...r.issues, ...extra], model: usedModel };
  } finally {
    if (uploaded?.name) ai.files.delete({ name: uploaded.name }).catch(() => {});
  }
}
