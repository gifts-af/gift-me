import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { connection } from "next/server";
import { ImageResponse } from "next/og";
import GenericCard from "@/app/opengraph-image";
import { APP_DOMAIN, APP_NAME } from "@/lib/brand";
import { holidayLogoNow } from "@/lib/holiday";
import { STICKER, tagSvg } from "@/lib/logo-art";
import { getSharePreview } from "@/modules/lists";

// The link-preview image for a shared list (ALL-123): "Sam Lee’s wish list",
// the count and the logo's tag, nothing else. It reads only getSharePreview, which touches no
// gift, price, photo or claim, so a claim can't spoil the surprise. An unknown
// or reset link, no name, or the setting off gives the generic card (ALL-55).

export const alt = `${APP_NAME} wish list`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Same dark look as the generic card (app/opengraph-image.tsx).
const PAGE = "#09090b";
const TEXT = "#fafafa";
const MUTED = "#a1a1aa";
const TEAL = "#2dd4bf";

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

// Names may be 80 characters. Past this the card cuts them, so a name never
// pushes "wish list" off the picture.
const MAX_NAME = 32;

function possessive(name: string) {
  const chars = Array.from(name);
  return `${chars.length > MAX_NAME ? `${chars.slice(0, MAX_NAME - 1).join("")}…` : name}’s`;
}

// The name has the 620 px beside the tag: shorter type for a long word or name.
function nameSize(text: string) {
  const word = Math.max(...text.split(/\s+/).map((w) => Array.from(w).length));
  if (word <= 9 && text.length <= 18) return 96;
  return word <= 13 && text.length <= 26 ? 72 : 52;
}

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  // Per request, never prerendered: a reset link must stop showing the name.
  await connection();
  const { token } = await params;
  const preview = await getSharePreview(token);
  if (!preview || !preview.ownerName) return GenericCard();

  const [black, regular, holiday] = await Promise.all([
    font("Geist-Black.ttf"),
    font("Geist-Regular.ttf"),
    holidayLogoNow(),
  ]);
  const n = preview.itemCount;
  const count = n === 0 ? "No wishes yet" : `${n} ${n === 1 ? "wish" : "wishes"}`;
  const tag = `data:image/svg+xml,${encodeURIComponent(tagSvg({ holiday }))}`;
  const owner = possessive(preview.ownerName);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 80px",
          background: PAGE,
          color: TEXT,
          fontFamily: "Geist",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws an <img>, not a page */}
        <img src={tag} width={460} height={394} alt="" style={{ position: "absolute", right: 30, top: 110 }} />
        <div style={{ display: "flex", fontSize: 56, fontWeight: 900, letterSpacing: -2 }}>{APP_NAME}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, width: 620 }}>
          <div
            style={{
              display: "flex",
              fontSize: nameSize(owner),
              fontWeight: 900,
              letterSpacing: -3,
              lineHeight: 1.05,
              wordBreak: "break-word",
            }}
          >
            {owner}
          </div>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 900, letterSpacing: -3, lineHeight: 1, color: STICKER }}>
            wish list
          </div>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 400, color: MUTED }}>{count}</div>
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
