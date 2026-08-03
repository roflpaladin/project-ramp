import type { ReactNode } from "react";
import "./globals.css";
import { ThemeProvider } from "./theme-provider";

export const metadata = {
  title: "Project Ramp",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes sets data-theme on the client after hydration (it can't
    // know the OS preference during the server render) — suppressHydrationWarning
    // is the documented way to stop React flagging that expected mismatch.
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
