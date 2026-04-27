import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TokenSaver",
  description: "Never hit token limits again"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
