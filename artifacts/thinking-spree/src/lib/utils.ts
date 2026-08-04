import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Merge Tailwind class names conditionally and safely.
 *
 * `clsx` flattens the arguments (strings, arrays, and `{ class: boolean }`
 * maps) into a single class string; `twMerge` then de-duplicates conflicting
 * Tailwind utilities so the last one wins (e.g. `cn("p-2", "p-4")` → `"p-4"`).
 *
 * This is the class-composition helper used by every UI component in the app.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
