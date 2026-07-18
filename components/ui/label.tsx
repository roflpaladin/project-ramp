import type { LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("flex flex-col gap-2 text-sm font-medium leading-none text-neutral-900 dark:text-neutral-50", className)}
      {...props}
    />
  );
}
