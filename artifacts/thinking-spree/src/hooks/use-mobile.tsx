import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Reactive viewport check: returns `true` while the window is narrower than
 * `MOBILE_BREAKPOINT` (768px), updating on resize via a `matchMedia` listener.
 * Returns `false` during the first render before the effect runs (SSR-safe).
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
