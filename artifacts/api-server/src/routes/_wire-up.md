# Backend wire-up

These two routes need to be registered in your Express app entry
(`artifacts/api-server/src/index.ts` or wherever you do `app.use(...)`).

```ts
import { cohortsRouter }      from "./routes/cohorts.js";
import { sprintEmailsRouter } from "./routes/sprint-emails.js";

app.use("/api/cohorts", cohortsRouter);
// sprint-emails is parameterised on sprint id, so mount under sprints:
app.use("/api/sprints/:id/emails", sprintEmailsRouter);
```

## Places in your existing code that reference these new things

1. **`/admin/import` xlsx parser** — when importing Wadhwani-related rows,
   you may want to auto-add the founder to the Wadhwani cohort. Search for
   the importer's `inserted.push()` after a successful founder upsert and
   add (pseudocode):

   ```ts
   if (row.programName?.toLowerCase().includes("wadhwani")) {
     await db
       .insert(cohortCompanies)
       .values({ cohortId: WADHWANI_COHORT_ID, founderId: newFounder.id, source: "manual" })
       .onConflictDoNothing();
   }
   ```

2. **The existing pre-sprint email send** — if you have a current path
   that sends the pre-sprint email via Gmail without recording it in DB,
   you MUST start writing to `sprint_emails` (kind = 'pre-sprint') with the
   returned `Message-ID`. Otherwise `threadReplyTo` will have nothing to
   point at and post-sprint emails won't thread. The new
   `POST /api/sprints/:id/emails` already does this — switch the existing
   pre-sprint sender to call it instead of going direct to Gmail.

3. **Summary Sheet page filter** — to add the "Wadhwani Foundation" tab to
   your existing summary page, the cleanest path is a query param:
   `GET /api/founders?cohortSlug=wadhwani-foundation`. Add the param to
   your existing `/api/founders` handler with one extra JOIN:

   ```ts
   if (req.query.cohortSlug) {
     const [cohort] = await db
       .select({ id: cohorts.id })
       .from(cohorts)
       .where(eq(cohorts.slug, String(req.query.cohortSlug)))
       .limit(1);
     if (cohort) {
       qb = qb.innerJoin(
         cohortCompanies,
         and(
           eq(cohortCompanies.founderId, founders.id),
           eq(cohortCompanies.cohortId, cohort.id),
         ),
       );
     }
   }
   ```

## Render Cron (optional — for automatic sheet → cohort sync)

Add a Render Cron Job pointing at:

```
curl -X POST -H "Authorization: Bearer $INTERNAL_TOKEN" \
  https://your-app.onrender.com/api/cron/sync-cohorts
```

And a tiny route:

```ts
app.post("/api/cron/sync-cohorts", async (_req, res) => {
  // verify INTERNAL_TOKEN…
  const rows = await db
    .select({ id: cohorts.id })
    .from(cohorts)
    .where(isNotNull(cohorts.sourceSheetUrl));
  for (const c of rows) {
    try {
      await syncCohortFromSheet({ cohortId: c.id, /* admin user id */ });
    } catch { /* per-cohort failures logged via lastSyncError */ }
  }
  res.json({ ok: true });
});
```
