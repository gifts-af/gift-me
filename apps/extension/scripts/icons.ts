// Draws the extension's icons (16, 32, 48, 128 px) from the GiftsAF logo
// (ALL-48), so they match the web app's icons. The PNGs are committed; rerun
// this only when the logo changes:
//   pnpm --filter @gifts-af/extension icons
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { iconSvg } from "../../web/lib/logo-art.ts";
import { ICON_SIZES } from "../src/manifest.ts";

const out = fileURLToPath(new URL("../public/icons/", import.meta.url));
mkdirSync(out, { recursive: true });
for (const size of ICON_SIZES) {
  // No Santa hat: the store icon doesn't change with the season.
  const svg = iconSvg(size, { holiday: false, rounded: true });
  await sharp(Buffer.from(svg)).png().toFile(`${out}icon-${size}.png`);
  console.log(`icon-${size}.png`);
}
