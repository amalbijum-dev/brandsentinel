# BrandSentinel

BrandSentinel checks marketing content against a brand's rules before it gets published. You upload a poster, a social post, a PDF or a short video, and it tells you what's wrong with it: a date that doesn't match the event details, a missing registration link, a banned spelling of the brand name, text that's hard to read, a claim nobody can back up.

It doesn't approve anything by itself. Whoever made the content goes through the findings, and a manager signs off at the end.

We built it for the Inkloom AI Hackathon after noticing how often student-fest posters went out with the wrong date or venue, even though a "brand guidelines" PDF existed somewhere.

**Live site:** [brandsentinel-xymj.onrender.com](https://brandsentinel-xymj.onrender.com/login.html)

If you just want to look around, use the demo buttons on the sign-in page, or go straight in:

- [Open as a manager](https://brandsentinel-xymj.onrender.com/demo): brand kit, reviews, approvals
- [Open as an employee](https://brandsentinel-xymj.onrender.com/demo/employee): upload content and see what gets flagged

No sign-up needed. A sample brand kit for a made-up college fest is already loaded.4

---

## Trying it out

Sign in as the demo employee, open **New check**, and paste this:

```
Spectrum-Fest is back on 15 March. Free entry for all, best fest ever!
```

Run the check. It should flag the wrong date (the kit says 14 March), the hyphen in the brand name, the "best fest ever" claim, the free-entry claim (outsiders pay ₹200), and the missing venue, time and registration link.

From there you can:

- respond to each finding: accept it, say you fixed it your own way, reject it, or mark the guideline as unclear
- revise the text and run the check again, which keeps the old version
- submit it for review

Then sign in as the demo manager. You'll see it waiting on the dashboard. You can reply to individual findings, send it back, or approve it.

Images, PDFs and videos work the same way. For videos it looks at keyframes for the visuals and listens to the audio separately, so a wrong date said out loud gets caught too.

---

## What's in it

**For people making content**

- checks text, images, PDFs and videos (up to 9 files at once, videos up to 60 MB)
- every finding says what's wrong, which rule it breaks, and how to fix it, often with replacement text you can copy
- findings are marked as either confirmed or "possible", so you know what to double-check
- each report also lists what it couldn't check

**For managers**

- a brand kit: guidelines, approved facts, words to avoid, required info per content type, colour palette and logos
- you can import guidelines from a PDF instead of retyping them
- a review pipeline (Draft, Legal review, AI check, Brand check, Final check, Approved) with replies, comments and version history
- an Insights page that shows which mistakes keep coming up and which guidelines people keep marking as unclear
- team management, an audit log, and a JSON export of everything

**Under the hood**

- Gemini does the reading and reviewing; a separate rule engine handles checklists, banned words, colour distance and contrast, so those give the same answer every time
- claims are cross-checked against the approved facts without the AI, and disagreements are flagged for a person
- Aadhaar and PAN numbers are stripped out before anything is sent to the AI, and emails and phone numbers are too by default

---

## Running it yourself

You'll need Node.js 20 or newer and a Gemini API key (free from [Google AI Studio](https://aistudio.google.com/apikey)).

```bash
git clone https://github.com/amalbijum-dev/brandsentinel.git
cd brandsentinel
npm install
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Open `.env`, put your key after `GEMINI_API_KEY=`, then:

```bash
npm start
```

Go to http://localhost:5000. The first time, it asks you to create the organisation and a manager account. After that, open **Brand kit** and either click **Load demo kit** or start adding your own rules.

The app still runs without a key, but only the rule-based checks work.

### Settings

These go in `.env`. Everything except the key has a sensible default.

```
GEMINI_API_KEY=            # required for AI checks
GEMINI_MODEL=gemini-3-flash-preview
GEMINI_FALLBACK_MODELS=gemini-2.5-flash
MAX_FILE_MB=12
MAX_VIDEO_MB=60
DATA_DIR=data              # where the database and uploads live
DEMO_MODE=true             # set to false to hide the demo accounts
OLLAMA_URL=                # optional local model, text only
```

Set `NODE_ENV=production` when it's running behind HTTPS.

---

## Hosting

The live version runs on Render's free plan:

- build command: `npm install`
- start command: `npm start`
- environment variables: `GEMINI_API_KEY`, `NODE_ENV=production`, `DEMO_MODE=true`

Free Render instances go to sleep after 15 minutes, so we have an UptimeRobot monitor hitting the site every few minutes to keep it awake.

One catch: the free plan has no permanent disk, so accounts and submissions disappear whenever the service restarts or redeploys. The demo accounts rebuild themselves, but anything else is lost. If you need data to stick around, add a persistent disk and point `DATA_DIR` at it.

It won't run on Vercel or Netlify. The database is a plain JSON file, so it needs a server that stays running.

---

## API

If you want to run checks from another tool, generate a key under **Settings & API**:

```bash
curl -X POST https://brandsentinel-xymj.onrender.com/api/v1/check \
  -H "x-api-key: YOUR_KEY" \
  -F title="Fest poster" \
  -F contentType=poster \
  -F text="Spectrum Fest 2027 on 14 March..." \
  -F files=@poster.png
```

You get back a submission with the full report. Fetch it again later with `GET /api/v1/submissions/<id>`.

There's also a webhook setting. It sends `analysis.completed` and `submission.status_changed` events, signed with HMAC-SHA256 in the `x-brandsentinel-signature` header.

---

## Project layout

```
server.js        routes, login, review workflow, uploads
lib/analyze.js   builds the prompt, calls Gemini, merges results with the rule checks
lib/video.js     full-video and audio review
lib/checks.js    checklist, wording, claim and readability checks
lib/color.js     colour distance and contrast maths
lib/pii.js       redaction
lib/store.js     the JSON database, audit log and notifications
public/          the whole front end (plain JS, no framework)
```

---

## Known limitations

- It's a suggestion tool. Text read from images comes from the AI, so it can misread small print.
- Personal info inside images, PDFs or spoken in videos can't be redacted before it's sent to the AI.
- Everything is stored in one unencrypted JSON file. Fine for a demo or a small team, not for a company.
- "Published" is just a status. It doesn't post anywhere.

Things we'd like to add: a Chrome extension, Slack alerts, a Google Docs add-on, and a mode that runs entirely on local models.

---

## Security

Don't commit your `.env` file. If a key ever ends up somewhere public, delete it in Google AI Studio and make a new one.

If you find a security problem, please open an issue or contact the maintainer instead of posting details publicly.
