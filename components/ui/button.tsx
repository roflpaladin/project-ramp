import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "default" | "outline";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

/**
 * Sprint 10, Ticket 52. Split out of Button so a non-<button> element that
 * still needs to look like this Button (e.g. the HubSpot connection card's
 * "Connect HubSpot" link, which navigates a GET route rather than submitting
 * a form) reuses the exact same classes instead of a hand-copied drift-prone
 * duplicate.
 */
export function buttonClassName(variant: ButtonVariant = "default", className?: string): string {
  return cn(
    "inline-flex h-9 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    variant === "default" &&
      "border-transparent bg-neutral-900 text-neutral-50 hover:bg-neutral-700 dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-neutral-200",
    variant === "outline" &&
      "border-neutral-200 bg-transparent text-neutral-900 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-50 dark:hover:bg-neutral-800",
    className,
  );
}

// Shadcn/ui-style Button (native element, default + outline variants only).
export function Button({ className, variant = "default", ...props }: ButtonProps) {
  return <button className={buttonClassName(variant, className)} {...props} />;
}
