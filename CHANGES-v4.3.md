# Consultant Suite v4.3 — AI emails + Gmail send

## TL;DR

Full end-to-end Sprint workflow is now operational:

1. Drag-drop filled `Sprint_Template.xlsx` on `/companies` → parses everything
2. AI drafts the pre-sprint email using your exact template + Gemini
3. Calendar auto-fills sprint Day / Date / Time from Google Calendar
4. Consultant edits, clicks "Send via Gmail" → email sent from their inbox
5. Timeline auto-logs every step (draft, sent, sprint complete)
6. After sprint, re-upload the completed Excel → SWOT/Funding/etc. populate
7. "Generate Post-Sprint Email" uses the SWOT/direction/actionable steps
8. Send → done. Company stage advances to "Closed Out".

## What's new in v4.3

### AI email generation
- **Gemini integration** (`gemini-1.5-flash`) — fast, free-tier friendly
- Uses your **exact templates** (the ones you provided) as the structural spec
- Strict rules baked into the prompt:
  - No placeholder brackets left in the output (e.g. `[Founder's Name]`)
  - Missing fields are omitted, not hallucinated
  - SWOT lists rewritten as prose, not bullets
  - Sprint date softened if not found in calendar

### Calendar auto-fill
- When you click "Generate Pre-Sprint Email", the server searches your
  Google Calendar for the next 60 days for an event mentioning the company name
- Pulls Day / Date / Time formatted in IST
- A banner in the composer shows what was found (or warns if nothing matched)

### Gmail send
- One-click send via the consultant's connected Gmail account
- Logs `pre_email_sent` or `post_email_sent` event with the Gmail message ID
- Advances the company's workflow stage
- All sends are saved as drafts first (so the consultant doesn't lose work on refresh)

### Email Composer dialog
- Opens with the AI draft pre-filled (~2-3s)
- Editable subject + body
- Three actions: **Send via Gmail · Save Draft · Copy**
- "Additional notes for AI" collapsible — type extra context, click Regenerate
- Founder email pre-filled from the company record, but editable

### Sprint Template v2
- New row: **Founder's Email** (between Founder's Name and Deck attachment)
- Parser updated to read it; consultants no longer have to enter the email manually
- Old templates still work — the email field falls back to manual entry

### New API endpoints
- `POST /api/companies/:id/generate-email` — Gemini call (kind: 'pre' | 'post')
- `POST /api/companies/:id/send-email`     — Gmail send + timeline log
- `POST /api/companies/:id/drafts`         — save draft without sending
- `GET  /api/companies/:id/drafts`         — list saved drafts
- `GET  /api/ai/status`                    — quick check if Gemini key is configured

## Required environment variable

Add **one** new env var on Render:

| Key | Where to get it |
|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey → Create API key |

Render auto-redeploys after you save. No other changes needed.

## Required Google scopes

Your existing OAuth client already has the right scopes if you followed the
v4.1 setup. To confirm: open Settings → Google Connections in the app and
make sure both **Gmail** and **Calendar** show as connected.

If Gmail isn't connected:
1. Settings → Google Connections → "Connect Gmail"
2. Approve the permission for sending emails
3. You only need to do this once per consultant

## Deployment

```bash
# 1. Replace your local repo with this zip's contents
# 2. Push
git add -A
git commit -m "v4.3: AI emails + Gmail send + Calendar auto-fill"
git push

# 3. In Render env vars, add:
#    GEMINI_API_KEY = your_key_from_aistudio
#    (Render auto-redeploys)

# 4. Distribute the updated Sprint_Template_v2.xlsx to your consultants
```

## Updated Sprint Template

A new `Sprint_Template_v2.xlsx` is provided alongside this zip. It has the
same structure as the original plus the Founder's Email row. Old templates
still parse correctly — the new row is optional.

## Things to test after deploying

1. Login → Companies → drop the v2 template
2. Open the company → verify Founder Email shows up (no "Add founder email" prompt)
3. Click "Generate Pre-Sprint Email" → composer opens, draft appears in 2-3s
4. Edit the draft, click "Send via Gmail" → should land in the founder's inbox
5. Open Gmail "Sent" → confirm the email is there
6. Back in the app, open the company → Timeline → see "Pre-sprint email sent"
7. Mark sprint complete (Timeline → Mark complete)
8. Re-upload the completed Excel (with SWOT filled)
9. Generate Post-Sprint Email → should reference SWOT findings in prose
10. Send → company stage flips to "Closed Out"

## Known limitations (for a future v4.4 if needed)

- Gemini free tier has rate limits (~15 req/min). If you hit them, the
  composer will show the raw rate-limit error.
- The Calendar lookup matches on the company name appearing in the event
  title or description. If your event is titled "T-Sprint" with no company
  name, the lookup won't find it — add the company name to the event title.
- Drafts are saved per-company, not per-user-per-company. Two consultants
  editing the same company will see each other's drafts (this is fine for now
  given the consultant-ownership model, but worth knowing).
- The "About Startup" sheet in the template is currently free-text with no
  structured "Vision" field. The parser treats the entire sheet content as
  the vision string. If you want this more structured, let me know.

## File-level summary of changes from v4.2

| File | Change |
|---|---|
| `artifacts/api-server/package.json` | Added `@google/generative-ai` |
| `artifacts/api-server/src/lib/gemini.ts` | NEW — Gemini wrapper + templates + prompt |
| `artifacts/api-server/src/lib/sprintTemplateParser.ts` | Reads `Founder's Email` row |
| `artifacts/api-server/src/routes/companies.ts` | Uses parsed founder email |
| `artifacts/api-server/src/routes/companyEmails.ts` | NEW — generate/send/drafts |
| `artifacts/api-server/src/routes/index.ts` | Mounts companyEmails router |
| `artifacts/thinking-spree/src/components/EmailComposer.tsx` | NEW — composer dialog |
| `artifacts/thinking-spree/src/pages/company-detail.tsx` | Wires composer to action buttons |
| `Sprint_Template_v2.xlsx` | NEW — adds Founder's Email row |
