import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { EMAIL_LOGO_SIZE } from "@/lib/email-layout";
import { holidayLogoNow } from "@/lib/holiday";
import { INK, tagSvg } from "@/lib/logo-art";

// The GiftsAF wordmark at the top of every email (ALL-71): "Gifts" in heavy
// type, then the yellow "AF" tag, like components/logo.tsx. A PNG because
// Gmail doesn't show SVG. Drawn on a white badge with rounded corners: on a
// light email the badge can't be seen, and when a phone's dark mode darkens
// the email (Gmail does, and leaves pictures alone) it reads as a sticker
// instead of a white box. Drawn at twice the size the email shows it.
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
          borderRadius: 16,
          paddingLeft: 12,
          color: INK,
          fontFamily: "Geist",
          fontSize: 42,
          fontWeight: 900,
          letterSpacing: -1.5,
        }}
      >
        Gifts
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws an <img>, not a page */}
        <img src={tag} width={84} height={72} alt="" style={{ marginLeft: 3, marginTop: -10 }} />
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
