import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { APP_DOMAIN, APP_HOOK, APP_NAME, APP_PITCH } from "@/lib/brand";
import { holidayLogoNow } from "@/lib/holiday";
import { STICKER, tagSvg } from "@/lib/logo-art";

// The link-preview image for every page (ALL-55): LinkedIn, iMessage, Slack
// and others show it when someone shares a GiftsAF link. Same bold look as the
// home page, dark, with the logo (and its Christmas hat in season).

export const alt = `${APP_NAME}: ${APP_HOOK} ${APP_PITCH}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Colours from globals.css (dark theme): page, text, muted text, teal.
const PAGE = "#09090b";
const TEXT = "#fafafa";
const MUTED = "#a1a1aa";
const TEAL = "#2dd4bf";

// Geist (SIL Open Font License, assets/fonts/Geist-OFL.txt): the image can't
// use the device's own font, so it carries its own.
const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

export default async function Image() {
  const [black, regular, holiday] = await Promise.all([
    font("Geist-Black.ttf"),
    font("Geist-Regular.ttf"),
    holidayLogoNow(),
  ]);
  const tag = `data:image/svg+xml,${encodeURIComponent(tagSvg({ holiday }))}`;
  const [lead, wink] = [APP_HOOK.replace(/ AF\.$/, ""), "AF."];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 80px",
          background: PAGE,
          color: TEXT,
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 56, fontWeight: 900, letterSpacing: -2 }}>
          Gifts
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws an <img>, not a page */}
          <img src={tag} width={115} height={98} alt="" style={{ marginLeft: 6, marginTop: -20 }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 112, fontWeight: 900, letterSpacing: -4, lineHeight: 1 }}>
            {lead}&nbsp;<span style={{ color: STICKER }}>{wink}</span>
          </div>
          <div style={{ display: "flex", fontSize: 38, fontWeight: 400, color: MUTED, lineHeight: 1.3, maxWidth: 900 }}>
            {APP_PITCH}
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 30, fontWeight: 900, color: TEAL }}>{APP_DOMAIN}</div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: black, weight: 900, style: "normal" },
        { name: "Geist", data: regular, weight: 400, style: "normal" },
      ],
    },
  );
}
