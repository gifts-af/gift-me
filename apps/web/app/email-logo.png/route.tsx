import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { EMAIL_LOGO_SIZE } from "@/lib/email-layout";
import { holidayLogoNow } from "@/lib/holiday";
import { INK, tagSvg } from "@/lib/logo-art";

// The GiftsAF wordmark at the top of every email (ALL-71): "Gifts" in heavy
// type, then the yellow "AF" tag, like components/logo.tsx. A PNG because
// Gmail doesn't show SVG. Emails are always light (T33), so it's drawn on
// white. Drawn at twice the size the email shows it.
const SCALE = 2;

export async function GET() {
  const [black, holiday] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts", "Geist-Black.ttf")),
    holidayLogoNow(),
  ]);
  const tag = `data:image/svg+xml,${encodeURIComponent(tagSvg({ holiday }))}`;
  const width = EMAIL_LOGO_SIZE.width * SCALE;
  const height = EMAIL_LOGO_SIZE.height * SCALE;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background: "#ffffff",
          color: INK,
          fontFamily: "Geist",
          fontSize: 48,
          fontWeight: 900,
          letterSpacing: -1.5,
        }}
      >
        Gifts
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws an <img>, not a page */}
        <img src={tag} width={94} height={80} alt="" style={{ marginLeft: 4, marginTop: -12 }} />
      </div>
    ),
    {
      width,
      height,
      fonts: [{ name: "Geist", data: black, weight: 900, style: "normal" }],
      headers: { "Cache-Control": "public, max-age=86400" },
    },
  );
}
