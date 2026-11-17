import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { GeistPixelSquare } from "geist/font/pixel/square";
import { ReferencesProvider } from "@/components/references-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "World Material Library — Design Reference Capture",
  description:
    "Capture design references, extract elements, and copy generative prompts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${GeistPixelSquare.variable} h-full antialiased`}
    >
      <body
        className={`${GeistSans.className} flex min-h-full flex-col bg-[#f4f4f4] text-black`}
      >
        <ReferencesProvider>{children}</ReferencesProvider>
      </body>
    </html>
  );
}
