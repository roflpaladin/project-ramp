import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Shadcn/ui-style select styled like SelectTrigger, but a native <select> so
// the static shell works without client JS or a Radix dependency — the form
// posts through a plain server action (progressive enhancement, matching the
// rest of the admin surface).
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full cursor-pointer appearance-none rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-neutral-600",
        className,
      )}
      {...props}
    />
  );
}
