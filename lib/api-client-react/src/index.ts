/**
 * Public entry point for the React API client package (`@workspace/api-client-react`).
 *
 * Re-exports:
 *  - the Orval-generated typed endpoints and request/response schemas
 *    (`./generated/*`), and
 *  - the hand-written `customFetch` transport plus its runtime configuration
 *    (`setBaseUrl`, `setAuthTokenGetter`) that every generated call routes
 *    through.
 *
 * Consumers should import from this barrel rather than reaching into
 * `./generated` or `./custom-fetch` directly.
 */
export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter, customFetch } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";
