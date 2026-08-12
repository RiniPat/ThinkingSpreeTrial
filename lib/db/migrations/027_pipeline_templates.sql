-- 027_pipeline_templates.sql
-- Tag follow-up templates by pipeline stage and seed the two later-stage
-- templates (Nudge, Reminder with Toffee) so the consultant sends each stage
-- like the first outreach. Ops/Admin edit the copy in the Templates tab.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + NOT EXISTS-guarded inserts + a bounded
-- UPDATE that only fills nulls.

ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS pipeline_stage text; -- outreach | nudge | toffee | NULL

-- Existing follow-up content templates are first-outreach templates.
UPDATE email_templates
   SET pipeline_stage = 'outreach'
 WHERE kind = 'followup' AND pipeline_stage IS NULL;

-- Stage 2 — Nudge (7 days after outreach, no reply).
INSERT INTO email_templates (kind, name, subject, sort_order, pipeline_stage, body)
SELECT 'followup', 'Nudge', 'Following up — [Company]', 10, 'nudge',
$body$<p>Hi [First Name],</p><p>Just floating my previous note back to the top of your inbox. I know how quickly things move at [Company], so no pressure at all.</p><p>If the timing works, I would still love a short conversation about where things stand and whether a focused next step would be useful.</p><p>Would any time next week suit you? Happy to work around your calendar.</p><p>Warm regards,<br>[Name]<br>[Title], Thinking Spree<br>[Phone] | [Calendar link]</p>$body$
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE kind = 'followup' AND name = 'Nudge');

-- Stage 3 — Reminder with Toffee (7 days after nudge, no reply). A warm, light
-- final reminder. Ops/Admin can rewrite the copy.
INSERT INTO email_templates (kind, name, subject, sort_order, pipeline_stage, body)
SELECT 'followup', 'Reminder with Toffee', 'One last note (with a little something) — [Company]', 11, 'toffee',
$body$<p>Hi [First Name],</p><p>I promise this is my last nudge for now. I have really enjoyed following [Company]'s journey and did not want to let the thread go cold without one more friendly hello.</p><p>To sweeten the ask: if we can find 20 minutes, the first round of chai and toffee is on me. I would love to hear what has changed and whether there is a way we can be useful.</p><p>If now is not the right time, just say the word and I will check back later in the year.</p><p>Warm regards,<br>[Name]<br>[Title], Thinking Spree<br>[Phone] | [Calendar link]</p>$body$
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE kind = 'followup' AND name = 'Reminder with Toffee');
