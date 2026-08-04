/**
 * Browser-side auth helpers.
 *
 * These call the API server directly with `credentials: "include"` so the
 * session cookie is sent and set by the browser — deliberately not routed
 * through the generated `customFetch` client, which is transport-only and
 * unaware of the cookie-based session flow.
 */

/** App base path (Vite `BASE_URL`) with any trailing slash stripped, so it can
 *  be concatenated with absolute `/api/...` paths without doubling the slash. */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * POST credentials to `/api/auth/login`. On success the server sets the session
 * cookie and this resolves with the parsed JSON user payload; on failure it
 * throws an `Error` carrying the server-provided message (or "Login failed").
 */
export async function loginRequest(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Login failed");
  }
  return res.json();
}

/**
 * POST new-account details to `/api/auth/signup`. Behaves like
 * {@link loginRequest}: sets the session cookie on success and throws the
 * server message (or "Signup failed") on error.
 */
export async function signupRequest(email: string, password: string, name: string) {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Signup failed");
  }
  return res.json();
}
