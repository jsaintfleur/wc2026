import type { Metadata, Viewport } from "next";
import "./globals.css";
import RegisterSW from "./register-sw";

export const metadata: Metadata = {
  title: "Compet 2026 — Live World Cup Tracker",
  description: "Live scores, fixtures, tables and bracket picks for the 2026 FIFA World Cup across Canada, Mexico and the United States.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Compet 2026",
    statusBarStyle: "black-translucent",
  },
  applicationName: "Compet 2026",
  icons: {
    icon: "/favicon.svg",
    apple: "/icon-192.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080c15",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* PWA: Apple touch icon + maskable shortcut */}
        <link rel="apple-touch-icon" href="/icon-192.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
