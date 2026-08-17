-- 028_ai_email_template.sql
-- Sales · Retargeting: a fully AI-written follow-up template ("AI Email").
--
-- Unlike the playbook templates (fixed HTML the AI only lightly personalises),
-- this template carries just a short placeholder body. When the consultant picks
-- it and hits "Generate AI draft", gemini.ts writes the ENTIRE warm re-engagement
-- email from the analysed T-sheet + session transcript — keyed on the template
-- name "AI Email". sort_order 0 keeps it first in the outreach stage.
--
-- Seeded once, guarded by NOT EXISTS so re-running on every deploy never dupes.

INSERT INTO email_templates (kind, name, subject, sort_order, pipeline_stage, body)
SELECT 'followup', 'AI Email', 'Reconnecting with [Company]', 0, 'outreach',
$body$<p>Click <strong>Generate AI draft</strong> to write a warm, personalised re-engagement email for [Company] from the analysed T-sheet and session transcript.</p>$body$
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE kind = 'followup' AND name = 'AI Email');
