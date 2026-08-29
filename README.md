# GoalX

A guided conversation that helps people discover what they truly want.

Eighteen questions from the outcome frame — drawn from linguistics, psychology, and the
_Zēteō_ framework — walked one at a time by **Skip**, an AI guide.

- **goalx.ai** → the landing page
- **app.goalx.ai** (and `goalx.ai/coach`) → the app

---

## What's in here

```
index.html            landing page
coach.html            the Skip app — served at /coach and at app.goalx.ai
api/_skip-prompt.js   Skip's personality + all 18 questions.  ← edit this to change Skip
api/chat.js           relays the conversation to the Claude API
api/email.js          one-time email relay via Resend
vercel.json           routing, cache and security headers
```

No framework. No build step. No database. No `npm install`.

---

## The privacy contract

This is the product promise, stated on the landing page. Don't break it without changing
the copy first.

- No database, no file writes, no `localStorage`, no `sessionStorage`, no cookies.
- No analytics script. Nothing beacons out.
- The conversation lives in the browser tab and dies with it.
- `api/chat.js` and `api/email.js` log a status code on failure, never a payload.
- `api/email.js` sends to exactly one recipient — the address the person typed. No BCC,
  no archive copy.

If you add usage tracking later, use counters that never touch content (see the build
notes doc, §3, "Decide on telemetry deliberately").

---

## Deploying

### 1. GitHub

Create a repo (`goalx-ai`) and upload everything in this folder. Do **not** commit a
`.env` file — `.gitignore` already excludes it.

### 2. Vercel

**Add New → Project → import the repo.** Framework preset: **Other**. Leave build command
and output directory empty.

Add environment variables under **Settings → Environment Variables**:

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | From [console.anthropic.com](https://console.anthropic.com) → API Keys. Set a monthly spend limit. |
| `RESEND_API_KEY` | No | Only for the "Email it to me" button. From [resend.com](https://resend.com), after verifying `goalx.ai` as a sending domain. Without it, the button tells people to download instead. |
| `GOALX_FROM_EMAIL` | No | Defaults to `Skip at GoalX <skip@goalx.ai>`. |
| `GOALX_MODEL` | No | Defaults to `claude-sonnet-5`. |

Deploy.

### 3. DNS at GoDaddy

In Vercel: **Settings → Domains**, add `goalx.ai` and `app.goalx.ai`. Vercel shows the
exact records. They'll look like:

| Type | Name | Value |
|---|---|---|
| A | `@` | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |
| CNAME | `app` | `cname.vercel-dns.com` |

Add them in GoDaddy under **goalx.ai → DNS → Manage Zones**. Use whatever Vercel shows
you if it differs. Certificates issue automatically once DNS resolves.

One project serves both domains — `vercel.json` routes `app.goalx.ai` to the coach app.

### 4. Before you promote it

`/api/chat` has no auth, by design. Turn on rate limiting under **Vercel → Firewall** so
an open endpoint against your API key stays a small problem.

---

## Changing Skip

Almost everything worth changing lives in **`api/_skip-prompt.js`**:

- `QUESTIONS` — all eighteen, each with a universal and a faith-track wording, its
  well-formedness condition, and what Skip should listen for.
- `FINAL_REFLECTIONS` — the four closing alignment questions.
- `buildSystemPrompt()` — tone rules, the banned-jargon list, faith/universal track
  behaviour, coach-mode behaviour, safety, and the summary format.

The coach panel's copy is duplicated client-side in the `Q` array at the top of
`coach.html`. **If you change a question, change it in both places.**

### The progress marker

Skip ends every message with `[[Q:7]]` (or `[[Q:19]]` for the final reflections, or
`[[Q:SUMMARY]]`). `api/chat.js` strips it before the client ever sees it and uses it to
drive the progress rail and the coach panel. Don't remove that instruction from the prompt.

---

## Running it locally

Static files can be opened directly, but the API routes need Vercel:

```bash
npx vercel dev
```

Then open http://localhost:3000. You'll need `ANTHROPIC_API_KEY` in a local `.env` file.

---

## Not a therapy product

The questions in this app reliably surface grief and shame, and occasionally something
more serious. `api/_skip-prompt.js` contains a safety block that stops the sequence on any
disclosure of crisis and points to professional support. The site footer carries the same
statement. Please don't remove either.
