import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EMC AI 階段判定器",
  description: "依實際設計製作內容，協助判斷案件為新製或再製。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
