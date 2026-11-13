# BrandSentinel

AI-assisted brand governance: checks content against your brand kit before publication, explains every finding and keeps humans in control of approvals.

## Run it
```bash
npm install
cp .env.example .env     # Windows: Copy-Item .env.example .env
# put your Gemini key in .env
npm start                # http://localhost:5000
```
First visit: create the **manager** account. The manager adds creators and reviewers under *Team*, then opens *Brand kit* and clicks **Load demo kit** (a fictional college-fest kit) or adds real guidelines.

Without a Gemini key the app still runs, using only the rule-based checks.

## Features
| Planned feature | Where |
|---|---|
| Required-information checklists (OCR + match) | Brand kit → checklists; deterministic pattern matching on pasted text and text read from images/PDF |
| Video / reel review | New check → upload a video; the browser picks keyframes at scene changes (max 8). **Full video review** at `/video-check.html` (or `POST /api/video-check`) sends the whole video to Gemini: speech, on-screen text and visuals are checked against the brand kit, with timestamps and a weak AI-content signal |
| Content relevance | Creator states the audience; the AI estimates who the content suits and flags a mismatch |
| Brand / tone / term rules | Guidelines, wording rules (glossary), approved palette, reference logos |
| Claim verification | AI verdict plus a non-generative second opinion (closest approved fact + number check); disagreements go to a human |
| Visual checks | Dominant colours (k-means in the browser) vs palette using CIEDE2000; contrast estimate; alt-text and readability checks |
| AI-content signal | Weak signal that prompts a disclosure check; never shown as proof |
| Workflow | AI check → creator accepts/modifies/rejects → legal review (only if sensitive) → manager final check → approved → published |
| Revision tracking | Every revision is a new version with its own report and decisions |
| Audit trail | Who did what and when (manager: Audit log) |
| Insights | Guidelines creators reject or mark "unclear" most |
| Integrations | REST API (`/api/v1/check`), signed webhooks, in-app notifications |
| Privacy | Aadhaar/PAN always redacted before the AI call; emails/phones optional; export and delete your data |

## Accounts
- First visit: `/login.html` creates the manager account.
- Self sign-up at `/signup.html` creates **creator** accounts only; a manager can turn it off (`allowSignup` setting) and change roles under Team.

## Roles
- **Creator**: submits content, responds to findings, revises, submits for review.
- **Reviewer** (legal/compliance): reviews sensitive content.
- **Manager**: manages the kit, team and settings, gives final approval, marks published.

## REST API
Generate a key under *Settings & API*, then:
```bash
curl -X POST http://localhost:5000/api/v1/check -H "x-api-key: KEY" \
  -F title="Fest poster" -F contentType=poster -F audience="first-year students" \
  -F text="Spectrum Fest 2027 on 14 March..." -F files=@poster.png
curl http://localhost:5000/api/v1/submissions/ID -H "x-api-key: KEY"
```
Webhook events: `analysis.completed`, `submission.status_changed`, signed with HMAC-SHA256 (`x-brandsentinel-signature`).

## Security notes
- **Never commit `.env`.** If a key was ever shared or placed in `.env.example`, rotate it in Google AI Studio.
- Passwords use scrypt; sessions are signed HttpOnly SameSite=Strict cookies; state-changing requests need a custom header; CSP is enabled and the UI never uses `innerHTML` for user content.
- Data is stored in `data/db.json` plus `data/uploads/` (both git-ignored via `data/` below). For real deployments move to Postgres/object storage, set `NODE_ENV=production` behind HTTPS, and review the multer 1.x deprecation notice (upgrade to 2.x).
- Webhook URLs are set by managers only and are not blocked from private addresses.

## Limitations
- Findings are suggestions. Exact facts (dates, hex colours) are checked by code, but OCR text comes from the AI model.
- Palette and contrast checks use dominant colours, not the text itself, and are reported as estimates.
- Logo comparison is a visual AI judgement marked "possible".
- "Published" is a status; the app does not post to social platforms.
- Planned but not built: Chrome extension, Slack/WhatsApp notifications, Figma/Docs add-ons, PaddleOCR (Gemini does OCR here).
