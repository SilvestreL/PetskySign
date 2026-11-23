import type { Metadata } from "next";
import localFont from "next/font/local";

import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";
import { appLocale, tr } from "@/lib/petsky/locale";

// Inter, the Petsky typeface, from files in the repo (OFL license beside
// them): the build does not depend on reaching Google Fonts.
const inter = localFont({
  display: "swap",
  src: [
    {
      path: "./fonts/inter-latin-wght-normal.woff2",
      style: "normal",
      weight: "400 700",
    },
    {
      path: "./fonts/inter-latin-wght-italic.woff2",
      style: "italic",
      weight: "400 700",
    },
  ],
  variable: "--font-ui",
});

export const metadata: Metadata = {
  title: "Petsky",
  description: tr("Electronic signature for Petsky contracts."),
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang={appLocale() === "pt-BR" ? "pt-BR" : "en"}>
      <body className={`${inter.variable} antialiased`}>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
