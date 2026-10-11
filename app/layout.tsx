import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import { ThemeProvider } from "./theme-provider";

const geistSans = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-geist-mono",
});

// Plain string, no "%s · Brava" template: every page that sets its own title
// already ends in "— Brava", so a template would double the brand name.
export const metadata: Metadata = {
  title: "Brava",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes sets data-theme on the client after hydration (it can't
    // know the OS preference during the server render) — suppressHydrationWarning
    // is the documented way to stop React flagging that expected mismatch.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
