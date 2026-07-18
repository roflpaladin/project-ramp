// Shadcn/ui convention: class-joining helper. Plain join (no tailwind-merge)
// keeps the dependency footprint at zero — callers just avoid passing
// conflicting utilities.
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
