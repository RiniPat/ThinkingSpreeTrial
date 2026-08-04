-- 020_followup_templates.sql
-- Sales · Follow-ups templates now live in the shared `email_templates` table
-- as kind = 'followup', so the team can edit copy without a deploy.
--
-- Adds two columns used by follow-ups (existing pre/post rows ignore them) and
-- seeds the three playbook templates exactly once (guarded by NOT EXISTS on
-- kind+name, so re-running this migration on every deploy never duplicates).
--
-- Bodies use [Square Bracket] placeholders. The app auto-fills [First Name],
-- [Company], [Name] and highlights the rest for the consultant to complete.

ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS subject    text;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- 1) Catch-up ────────────────────────────────────────────────────────────────
INSERT INTO email_templates (kind, name, subject, sort_order, body)
SELECT 'followup', 'Catch-up', 'Catching up on [Company]', 1,
$body$<p>Hi [First Name],</p><p>I hope you’ve been well. I was recently revisiting our work with [Company] and the priorities we had identified around [previous growth priority].</p><p>At the time, the next milestone was to [specific target or objective]. I’d love to hear what has changed since then—what has progressed, what remains difficult, and which growth question is most important for you now.</p><p>Based on our previous work together, I believe we may be able to help with [one or two relevant areas], without needing to restart the discovery process from scratch.</p><p>Would you be open to a 20-minute catch-up next week? We can review where things stand and determine whether a focused intervention would be useful. If there is a fit, we can then suggest a clearly scoped option with timelines, outcomes and pricing.</p><p>I’m available on [Option 1] or [Option 2], but happy to work around your schedule.</p><p>Warm regards,<br>[Name]<br>[Title], Thinking Spree<br>[Phone] | [Calendar link]</p>$body$
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE kind = 'followup' AND name = 'Catch-up');

-- 2) Two-sprint intervention ──────────────────────────────────────────────────
INSERT INTO email_templates (kind, name, subject, sort_order, body)
SELECT 'followup', 'Two-sprint intervention', 'A focused next step for [Company]', 2,
$body$<p>Hi [First Name],</p><p>It was great working with you on [previous engagement or programme]. During our earlier sessions, we identified [specific challenge] as an important lever for [Company]’s growth.</p><p>Given the progress you had already made in [relevant strength or achievement], I believe the next practical step could be a focused two-sprint intervention covering:</p><ul><li>[Deliverable or activity 1]</li><li>[Deliverable or activity 2]</li><li>[Deliverable or activity 3]</li></ul><p>The goal would be to help your team reach a clear decision or produce a usable outcome—such as [specific result]—within [time period].</p><p>We can offer this focused intervention at <strong>₹[amount] plus GST</strong>. This would be a contained engagement rather than a long-term commitment and would include [number] working sessions, supporting analysis and a clear action plan for your team.</p><p>At the end of the two sprints, we can jointly review the outcome and decide whether any further support would be valuable.</p><p>Would you be open to a short call to review the idea and update us on what has changed since our last conversation? I can do [Option 1] or [Option 2].</p><p>Warm regards,<br>[Name]<br>[Title], Thinking Spree<br>[Phone] | [Calendar link]</p>$body$
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE kind = 'followup' AND name = 'Two-sprint intervention');

-- 3) Phased engagement ────────────────────────────────────────────────────────
INSERT INTO email_templates (kind, name, subject, sort_order, body)
SELECT 'followup', 'Phased engagement', 'Next phase options for [Company]', 3,
$body$<p>Hi [First Name],</p><p>It was a pleasure supporting [Company] during [previous programme or engagement]. Our earlier work highlighted three important opportunities:</p><ol><li>[Priority or opportunity 1]</li><li>[Priority or opportunity 2]</li><li>[Priority or opportunity 3]</li></ol><p>Based on where the business was heading, we see a possible next phase focused on achieving [measurable commercial or strategic outcome].</p><p>A potential engagement could include:</p><p><strong>Phase 1: Reassessment and prioritisation</strong><br>Review progress since our last session, update the diagnosis and identify the highest-impact constraint.</p><p><strong>Phase 2: Strategy development</strong><br>Build the required [growth plan, positioning, channel strategy, sales process or customer-insight system].</p><p><strong>Phase 3: Activation and iteration</strong><br>Support your team in testing the approach, reviewing results and improving execution.</p><p>We can structure the engagement in one of two ways:</p><p><strong>Focused intervention</strong><br>[Two/four] T-Sprints over [time period] at <strong>₹[amount] plus GST</strong>. This would focus on [specific challenge] and deliver [specific output or decision].</p><p><strong>Implementation partnership</strong><br>[Six/twelve] T-Sprints over [time period] starting at <strong>₹[amount] plus GST</strong>. This would include strategy development, activation support, performance reviews and iteration with your team.</p><p>The final scope can be adjusted based on what has changed since our previous engagement and the level of hands-on support your team currently needs.</p><p>Could we schedule 20–30 minutes to understand where things stand and explore which option, if either, would be most relevant? I’m available on [Option 1] or [Option 2].</p><p>Warm regards,<br>[Name]<br>[Title], Thinking Spree<br>[Phone] | [Calendar link]</p>$body$
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE kind = 'followup' AND name = 'Phased engagement');
