/**
 * Application roles. Stored as TEXT on users.role (no DB enum so we can
 * add roles in the future without a migration). The frontend uses these
 * values verbatim for tab visibility.
 *
 * - consultant : default role; sees everything in the app. In the Sales
 *                follow-ups tool they are SCOPED to companies they hosted or
 *                co-hosted (matched by name / sprint-host alias).
 * - sales      : sees Sales tab + sees own Research outputs. Sees ALL follow-ups.
 * - research   : sees Research tab + sees own outputs; no Sales tab
 * - ops        : Operations. Sees the Sales tab with ALL cohorts/consultants and
 *                the Ops tracking view (per-consultant follow-up progress). Not a
 *                full admin — cannot change roles.
 * - admin      : everything + can change other users' roles
 */
export const ROLES = ["consultant", "sales", "research", "ops", "admin"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(s: unknown): s is Role {
  return typeof s === "string" && (ROLES as readonly string[]).includes(s);
}

/** Who can see the "Research" sidebar group. */
export function canAccessResearch(role: string | null | undefined): boolean {
  return role === "consultant" || role === "research" || role === "admin";
}

/** Who can see the "Sales" sidebar group. */
export function canAccessSales(role: string | null | undefined): boolean {
  return role === "consultant" || role === "sales" || role === "ops" || role === "admin";
}

/**
 * Who can see the Operations tracking view (per-consultant follow-up progress)
 * AND sees the full, unscoped follow-up list. Ops + Admin only.
 */
export function canViewSalesOps(role: string | null | undefined): boolean {
  return role === "ops" || role === "admin";
}

/**
 * Whether this role is SCOPED down to only the companies they hosted or
 * co-hosted in the Sales follow-ups tool. Only the field-consultant role is
 * scoped; sales/ops/admin are oversight roles and see everything.
 */
export function isConsultantScoped(role: string | null | undefined): boolean {
  return role === "consultant";
}

/** Who can use the Inbox CRM (the new Sales tab). Sales + Admin only. */
export function canAccessInboxCrm(role: string | null | undefined): boolean {
  return role === "sales" || role === "admin";
}

/** Who can change other users' roles. */
export function canManageRoles(role: string | null | undefined): boolean {
  return role === "admin";
}
