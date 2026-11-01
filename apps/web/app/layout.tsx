import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { APP_HOOK, APP_NAME, APP_PITCH, APP_TAGLINE } from "@/lib/brand";
import { holidayLogoNow } from "@/lib/holiday";
import { siteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: APP_NAME,
  description: APP_TAGLINE,
  // Link previews (ALL-55). The image is app/opengraph-image.tsx, and every
  // page inherits these unless it sets its own. No og:url here: each page's
  // own address is used, so a shared list's card opens that list.
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: `${APP_NAME} · ${APP_HOOK}`,
    description: APP_PITCH,
  },
  twitter: { card: "summary_large_image" },
  // iOS reads these, not the manifest, when adding to the home screen.
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
};

// The browser bar matches the page in light and dark.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The logo's Santa hat shows while this is set (ALL-48).
  const holiday = await holidayLogoNow();
  return (
    <html lang="en" suppressHydrationWarning data-holiday={holiday ? "" : undefined}>
      <body className="font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
