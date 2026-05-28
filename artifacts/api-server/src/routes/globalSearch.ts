/**
 * Global search across the user's workspace.
 *
 * Searches: companies (founders table), sales leads, research outputs,
 * proposals. Returns top N matches across all categories, with each result
 * tagged by its `kind` so the UI can render an icon + link.
 *
 * Query: q (required), limit (optional, default 8 per kind)
 *
 * Authorization: respects role-based access. Sales-only users don't get
 * research hits in their results, etc. Consultants and admins get all
 * categories.
 */
import { Router } from "express";
import {
  db, usersTable, foundersTable, researchOutputsTable,
  salesLeadsTable, proposalsTable,
  canAccessResearch, canAccessSales,
} from "@workspace/db";
import { eq, or, sql, ilike } from "drizzle-orm";

const router = Router();

async function getMe(req: any, res: any) {
  const uid = req.session?.userId;
  if (!uid) { res.status(401).json({ error: "Not authenticated" }); return null; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1);
  if (!u) { res.status(401).json({ error: "User not found" }); return null; }
  return u;
}

router.get("/search", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  const q = String(req.query.q ?? "").trim();
  const limit = Math.min(Math.max(Number(req.query.limit ?? 8), 1), 20);
  if (!q || q.length < 2) { res.json({ results: [] }); return; }

  // ILIKE-safe pattern: escape % and _, then wrap.
  const safeQ = q.replace(/[\\%_]/g, "\\$&");
  const like = `%${safeQ}%`;

  try {
    const companiesPromise = db
      .select({
        id: foundersTable.id,
        title: foundersTable.companyName,
        subtitle: foundersTable.name,
      })
      .from(foundersTable)
      .where(or(
        ilike(foundersTable.companyName, like),
        ilike(foundersTable.name, like),
        ilike(foundersTable.email, like),
      ))
      .limit(limit);

    const leadsPromise = canAccessSales(me.role)
      ? db.select({
          id: salesLeadsTable.id,
          title: salesLeadsTable.companyName,
          subtitle: salesLeadsTable.contactName,
        })
        .from(salesLeadsTable)
        .where(or(
          ilike(salesLeadsTable.companyName, like),
          ilike(salesLeadsTable.contactName, like),
          ilike(salesLeadsTable.contactEmail, like),
          ilike(salesLeadsTable.notes, like),
        ))
        .limit(limit)
      : Promise.resolve([]);

    const researchPromise = canAccessResearch(me.role)
      ? db.select({
          id: researchOutputsTable.id,
          title: researchOutputsTable.title,
          subtitle: researchOutputsTable.tool,
        })
        .from(researchOutputsTable)
        .where(ilike(researchOutputsTable.title, like))
        .limit(limit)
      : Promise.resolve([]);

    const proposalsPromise = canAccessSales(me.role)
      ? db.select({
          id: proposalsTable.id,
          title: proposalsTable.prospectCompany,
          subtitle: proposalsTable.prospectName,
        })
        .from(proposalsTable)
        .where(or(
          ilike(proposalsTable.prospectCompany, like),
          ilike(proposalsTable.prospectName, like),
          ilike(proposalsTable.brief, like),
        ))
        .limit(limit)
      : Promise.resolve([]);

    const [companies, leads, research, proposals] = await Promise.all([
      companiesPromise, leadsPromise, researchPromise, proposalsPromise,
    ]);

    res.json({
      results: [
        ...companies.map(r => ({ ...r, kind: "company" as const, href: `/companies/${r.id}` })),
        ...leads.map(r => ({ ...r, kind: "lead" as const, href: `/sales/leads` })),
        ...proposals.map(r => ({ ...r, kind: "proposal" as const, href: `/sales/proposals` })),
        ...research.map(r => ({ ...r, kind: "research" as const, href: `/research` })),
      ],
    });
  } catch (err) {
    req.log.error({ err }, "Search failed");
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
