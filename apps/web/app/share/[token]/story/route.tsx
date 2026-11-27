import { ImageResponse } from "next/og";
import { APP_DOMAIN, APP_HOOK, APP_NAME, APP_PITCH } from "@/lib/brand";
import { holidayLogoNow } from "@/lib/holiday";
import { STICKER, tagSvg } from "@/lib/logo-art";
import { getSharePreview } from "@/modules/lists";
import { MUTED, PAGE, TEAL, TEXT, characters, geistFonts, possessive, wishCount } from "../card-art";

// The list as an Instagram Story, 1080×1920: the logo, "Sam Lee’s wish list", the count and
// the domain, with the lower middle left empty for Instagram's link sticker. Same rules as
// the link-preview card: it reads only getSharePreview (no gift or claim), and an unknown or
// reset link, no name, or the setting off gives a generic card.

const size = { width: 1080, height: 1920 };

// Never cached: a reset link must stop showing the name. Not for search either.
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

// The name has 920 px: shorter type for a long word or name.
function nameSize(text: string) {
  const word = Math.max(...text.split(/\s+/).map((w) => characters(w).length));
  const { length } = characters(text);
  if (word <= 9 && length <= 18) return 136;
  return word <= 13 && length <= 26 ? 104 : 76;
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [preview, fonts, holiday] = await Promise.all([getSharePreview(token), geistFonts(), holidayLogoNow()]);
  const tag = `data:image/svg+xml,${encodeURIComponent(tagSvg({ holiday }))}`;
  const named = preview?.ownerName ? preview : null;
  const owner = named ? possessive(named.ownerName!) : "";
  const [lead, wink] = [APP_HOOK.replace(/ AF\.$/, ""), "AF."];

  return new ImageResponse(
    (
      // Instagram covers about 250 px at the top and bottom, so nothing sits there.
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "240px 80px 260px",
          background: PAGE,
          color: TEXT,
          fontFamily: "Geist",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws an <img>, not a page */}
        <img src={tag} width={420} height={360} alt="" />
        <div style={{ display: "flex", marginTop: 24, fontSize: 64, fontWeight: 900, letterSpacing: -2 }}>{APP_NAME}</div>

        {named ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, marginTop: 110, width: 920 }}>
            <div
              style={{
                display: "flex",
                textAlign: "center",
                justifyContent: "center",
                fontSize: nameSize(owner),
                fontWeight: 900,
                letterSpacing: -4,
                lineHeight: 1.05,
                wordBreak: "break-word",
              }}
            >
              {owner}
            </div>
            <div style={{ display: "flex", fontSize: 136, fontWeight: 900, letterSpacing: -4, lineHeight: 1, color: STICKER }}>
              wish list
            </div>
            <div style={{ display: "flex", marginTop: 12, fontSize: 56, fontWeight: 400, color: MUTED }}>
              {wishCount(named.itemCount)}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32, marginTop: 110, width: 920 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                fontSize: 120,
                fontWeight: 900,
                letterSpacing: -4,
                lineHeight: 1.05,
              }}
            >
              <div style={{ display: "flex", justifyContent: "center", textAlign: "center" }}>{lead}</div>
              <div style={{ display: "flex", color: STICKER }}>{wink}</div>
            </div>
            <div style={{ display: "flex", textAlign: "center", fontSize: 48, fontWeight: 400, color: MUTED, lineHeight: 1.3 }}>
              {APP_PITCH}
            </div>
          </div>
        )}

        {/* The room for Instagram's link sticker. */}
        <div style={{ display: "flex", flexGrow: 1 }} />
        <div style={{ display: "flex", fontSize: 52, fontWeight: 900, color: TEAL }}>{APP_DOMAIN}</div>
      </div>
    ),
    { ...size, fonts, headers },
  );
}
