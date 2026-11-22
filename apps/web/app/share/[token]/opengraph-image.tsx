import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { connection } from "next/server";
import { ImageResponse } from "next/og";
import GenericCard from "@/app/opengraph-image";
import { APP_DOMAIN, APP_NAME } from "@/lib/brand";
import { getSharePreview } from "@/modules/lists";

// The link-preview image for a shared list (ALL-123): "Sam Lee's wish list"
// and the count, nothing else. It reads only getSharePreview, which touches no
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

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  // Per request, never prerendered: a reset link must stop showing the name.
  await connection();
  const { token } = await params;
  const preview = await getSharePreview(token);
  if (!preview || !preview.ownerName) return GenericCard();

  const [black, regular] = await Promise.all([font("Geist-Black.ttf"), font("Geist-Regular.ttf")]);
  const count = `${preview.itemCount} ${preview.itemCount === 1 ? "wish" : "wishes"}`;

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
        <div style={{ display: "flex", fontSize: 56, fontWeight: 900, letterSpacing: -2 }}>{APP_NAME}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 900, letterSpacing: -3, lineHeight: 1.05 }}>
            {preview.ownerName}
          </div>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 400, color: MUTED }}>wish list · {count}</div>
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
