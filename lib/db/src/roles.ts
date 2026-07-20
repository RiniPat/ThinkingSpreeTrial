/**
 * Application roles. Stored as TEXT on users.role (no DB enum so we can
 * add roles in the future without a migration). The frontend uses these
 * values verbatim for tab visibility.
 *
 * - consultant : default role; sees everything in the app
 * - sales      : sees Sales tab + sees own Research outputs
 * - research   : sees Research tab + sees own outputs; no Sales tab
 * - admin      : everything + can change other users' roles
 */
export const ROLES = ["consultant", "sales", "research", "admin"] as const;
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
  return role === "consultant" || role === "sales" || role === "admin";
}

/** Who can use the Inbox CRM (the new Sales tab). Sales + Admin only. */
export function canAccessInboxCrm(role: string | null | undefined): boolean {
  return role === "sales" || role === "admin";
}

/** Who can change other users' roles. */
export function canManageRoles(role: string | null | undefined): boolean {
  return role === "admin";
}
