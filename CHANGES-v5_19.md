# v5.19 — crash guard + fix for the blank /pre-sprint screen

## Root cause
The app had **no error boundary**. React's default behaviour is: if any
component throws while rendering, the ENTIRE tree unmounts — so a single error
anywhere shows a blank white page (sidebar and all), with the real cause hidden
in the browser console. That's why `/pre-sprint` went white with no clue on screen.

(The Pre-Sprint page itself renders correctly in isolation — verified by
server- and client-side render tests — so the blank was the missing guard
turning some runtime/data/deploy error into a total blackout.)

## Fixes
- **Global `ErrorBoundary`** (`components/ErrorBoundary.tsx`) wraps the router.
  Any crash now shows a readable panel with the actual error message + stack and
  a "Back to Dashboard" / "Reload" action — instead of a blank screen.
- **Fail-safe analysis renderers** — if a saved AI result has an unexpected
  shape, that one tab shows a small "couldn't display — Regenerate" card
  instead of taking down the whole page.

## To find the real error on your deployment
1. Redeploy this build. Open `/pre-sprint`; if it still errors you'll now SEE
   the message on screen — send me that text.
2. Or open DevTools (F12) → Console on the blank page and read the red error.
3. Also check DevTools → Network for a 404 on the main JS bundle — if present,
   it's a stale cached page: hard-refresh (Ctrl/Cmd+Shift+R) or clear the CDN.
4. Make sure migration 013 has run on the live DB (the new founders columns).
   Without it, the Pre-Sprint API 500s — you'll now get a visible error, not a
   blank.
