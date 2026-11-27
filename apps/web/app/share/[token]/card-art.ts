import { readFile } from "node:fs/promises";
import { join } from "node:path";

// What the list's link-preview card and its Story card share: the dark colours of
// app/opengraph-image.tsx, the Geist fonts, the name cut and the wish count.

export const PAGE = "#09090b";
export const TEXT = "#fafafa";
export const MUTED = "#a1a1aa";
export const TEAL = "#2dd4bf";

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

export async function geistFonts() {
  const [black, regular] = await Promise.all([font("Geist-Black.ttf"), font("Geist-Regular.ttf")]);
  return [
    { name: "Geist", data: black, weight: 900 as const, style: "normal" as const },
    { name: "Geist", data: regular, weight: 400 as const, style: "normal" as const },
  ];
}

// Names may be 80 characters. Past this the card cuts them, so a name never
// pushes "wish list" off the picture.
const MAX_NAME = 32;

// Whole characters as people see them: a joined emoji or an accented letter is one.
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
export const characters = (text: string) => Array.from(segmenter.segment(text), (s) => s.segment);

export function possessive(name: string) {
  const chars = characters(name);
  return `${chars.length > MAX_NAME ? `${chars.slice(0, MAX_NAME - 1).join("")}…` : name}’s`;
}

export const wishCount = (n: number) => (n === 0 ? "No wishes yet" : `${n} ${n === 1 ? "wish" : "wishes"}`);
