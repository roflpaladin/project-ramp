"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

// Ticket 29 foundation (T29-2 decision): both light and dark themes ship via
// OS preference — there is no visible toggle yet. `attribute="data-theme"`
// matches the token blocks in app/globals.css ([data-theme="dark"] { ... }),
// NOT next-themes' default `class` strategy. `defaultTheme="system"` +
// `enableSystem` means an AE or buyer who has never touched a toggle still
// gets the theme their OS is already in.
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="data-theme" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
