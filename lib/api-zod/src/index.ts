// The generated/api module holds the runtime zod validators (e.g.
// `LoginUserBody` is a zod.object). Both `generated/api.ts` and the
// `generated/types/` directory export symbols of the SAME name (one is a
// runtime value, the other a structural TS interface), so re-exporting both
// from this barrel collides. We expose the zod constants here (the common
// case) and let callers deep-import structural types when they need them:
//   import type { Founder } from "@workspace/api-zod/dist/generated/types/founder";
export * from "./generated/api";
