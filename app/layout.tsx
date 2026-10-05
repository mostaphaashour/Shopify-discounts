import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "إدارة أسعار SKU | Shopify",
  description: "معاينة وتعديل أسعار منتجات Shopify المحددة فقط.",
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
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}