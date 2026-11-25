import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "CampusOS | College ERP", description: "A secure workspace for college learning and operations." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
