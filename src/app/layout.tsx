import type { Metadata } from "next";
import { Cormorant_Garamond, Source_Sans_3, Space_Mono } from "next/font/google";
import "./globals.css";
import AuthStatus from "@/components/AuthStatus";

const displayFont = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const bodyFont = Source_Sans_3({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const monoFont = Space_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "WSI Pathology Analysis",
  description: "Whole-slide pathology data intake and analysis dashboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} antialiased`}
      >
        <a className="home-link" href="/">
          <span className="home-link-dot" />
          WSI Home
        </a>
        <AuthStatus />
        {children}
      </body>
    </html>
  );
}
