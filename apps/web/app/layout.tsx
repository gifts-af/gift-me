import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { holidayLogoNow } from "@/lib/holiday";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: APP_NAME,
  description: APP_TAGLINE,
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
