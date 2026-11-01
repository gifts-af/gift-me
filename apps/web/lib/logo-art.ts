// The GiftsAF logo's shapes (ALL-48, direction C1): "AF" on a tilted yellow
// gift tag whose hole is a heart, the <3 for Allens Forever. The wordmark
// (components/logo.tsx) and the generated app icons both draw from here.
//
// The tag is drawn in its own 76 x 40 frame with the point on the left.
// AF is drawn as shapes, not text, so the icons look the same everywhere.

// The --sticker pair from globals.css, as hex for the generated icons.
export const STICKER = "#facc15";
export const INK = "#18181b";

export const TAG_TILT = -8;

const TAG = "M18 0 H72 Q76 0 76 4 V36 Q76 40 72 40 H18 L0 20 Z";

// A heart in a 10 x 9 box, using only absolute points so it can be moved.
const HEART = "M5 9 C1 6 0 4 0 2.8 C0 1.2 1.2 0 2.6 0 C3.6 0 4.5 .6 5 1.4 C5.5 .6 6.4 0 7.4 0 C8.8 0 10 1.2 10 2.8 C10 4 9 6 5 9 Z";

function place(path: string, scale: number, x: number, y: number) {
  let i = 0;
  return path.replace(/-?\d*\.?\d+/g, (n) => {
    const v = Number(n) * scale + (i++ % 2 === 0 ? x : y);
    return String(Math.round(v * 100) / 100);
  });
}

// The tag with the heart punched through (fill-rule evenodd), and without.
export const TAG_WITH_HEART = `${TAG} ${place(HEART, 0.9, 8.5, 16)}`;
export const TAG_PLAIN = TAG;

// Heavy A and F in a 45 x 26 box; the A's counter is cut out by evenodd.
export const AF = "M0 26 L9 0 H16 L25 26 H18 L16.5 21 H8.5 L7 26 Z M10.2 15.5 H14.8 L12.5 8 Z M28 0 H45 V5.5 H35 V10.5 H43 V16 H35 V26 H28 Z";

// Where AF sits on the tag: smaller beside the heart, bigger without it.
export const AF_ON_TAG = "translate(24.6 7.6) scale(0.95)";
export const AF_ON_PLAIN_TAG = "translate(20.4 6.4) scale(1.05)";

// The Christmas layer, in its own boxes: a Santa hat (64 x 52) for the
// tag's top-right corner, and holly (40 x 24) for the icon's corner.
export const HAT = {
  crown: "M10 40 Q16 8 42 6 Q58 6 58 26 L50 22 Q44 16 38 22 L50 40 Z",
  brim: { x: 4, y: 36, width: 50, height: 13, rx: 6.5 },
  bobble: { cx: 56, cy: 27, r: 7 },
  red: "#dc2626",
  white: "#ffffff",
  edge: "#e4e4e7",
};
export const HAT_ON_TAG = "translate(44 -22) scale(0.6) rotate(14 32 26)";

const HOLLY = {
  leaves: [
    { d: "M20 12 Q10 2 2 8 Q8 10 6 16 Q14 18 20 12 Z", fill: "#15803d" },
    { d: "M20 12 Q30 2 38 8 Q32 10 34 16 Q26 18 20 12 Z", fill: "#16a34a" },
  ],
  berries: [
    { cx: 17, cy: 14, fill: "#dc2626" },
    { cx: 23, cy: 14, fill: "#dc2626" },
    { cx: 20, cy: 18, fill: "#b91c1c" },
  ],
};

// Below this size the heart and holly are too small to read.
const SMALL = 48;

function hatSvg() {
  const { brim, bobble } = HAT;
  return (
    `<g data-part="hat" transform="${HAT_ON_TAG}">` +
    `<path d="${HAT.crown}" fill="${HAT.red}"/>` +
    `<rect x="${brim.x}" y="${brim.y}" width="${brim.width}" height="${brim.height}" rx="${brim.rx}" fill="${HAT.white}" stroke="${HAT.edge}"/>` +
    `<circle cx="${bobble.cx}" cy="${bobble.cy}" r="${bobble.r}" fill="${HAT.white}" stroke="${HAT.edge}"/>` +
    `</g>`
  );
}

function hollySvg() {
  return (
    `<g data-part="holly" transform="translate(8 68) scale(0.75)">` +
    HOLLY.leaves.map((l) => `<path d="${l.d}" fill="${l.fill}"/>`).join("") +
    HOLLY.berries.map((b) => `<circle cx="${b.cx}" cy="${b.cy}" r="3.4" fill="${b.fill}"/>`).join("") +
    `</g>`
  );
}

// The app icon as an SVG string: the tag on a near-black square.
export function iconSvg(size: number, { holiday, rounded = true }: { holiday: boolean; rounded?: boolean }) {
  const small = size <= SMALL;
  const tag = small
    ? `<path data-part="tag" fill="${STICKER}" d="${TAG_PLAIN}"/>`
    : `<path data-part="tag" fill="${STICKER}" fill-rule="evenodd" data-heart="yes" d="${TAG_WITH_HEART}"/>`;
  const af = `<path data-part="af" fill="${INK}" fill-rule="evenodd" transform="${small ? AF_ON_PLAIN_TAG : AF_ON_TAG}" d="${AF}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" rx="${rounded ? 22 : 0}" fill="${INK}"/>` +
    // The tag fills most of the square, tilted like the home page sticker.
    `<g transform="rotate(${TAG_TILT - 2} 48 48) translate(10 28)">` +
    tag +
    af +
    (holiday ? hatSvg() : "") +
    `</g>` +
    (holiday && !small ? hollySvg() : "") +
    `</svg>`
  );
}
