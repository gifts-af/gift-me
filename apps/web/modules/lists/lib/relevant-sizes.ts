import { SIZE_KINDS, type SharedSize, type SizeKind } from "@/lib/size-kinds";

// Whole-word lists per kind. A wrong hit narrows the list to that kind (plus
// color), so a "Ring Light" shows only ring size. The phrase rules below exist
// to keep wrong hits from hiding a size the claimer needs.
const WORDS: Record<Exclude<SizeKind, "color">, string[]> = {
  shoe: ["shoe", "sneaker", "boot", "slipper", "sandal", "loafer", "heel", "cleat"],
  top: [
    "shirt", "tshirt", "tee", "sweater", "sweatshirt", "hoodie", "jacket", "coat",
    "fleece", "vest", "blouse", "polo", "top", "pullover", "cardigan", "pajama", "onesie",
  ],
  pants: [
    "pants", "jeans", "trousers", "shorts", "leggings", "joggers", "chinos",
    "sweatpants", "skirt",
  ],
  dress: ["dress", "gown"],
  ring: ["ring"],
  hat: ["hat", "cap", "beanie", "beret"],
};

const KIND_BY_WORD = new Map<string, SizeKind>(
  Object.entries(WORDS).flatMap(([kind, words]) =>
    words.map((w): [string, SizeKind] => [w, kind as SizeKind]),
  ),
);

// Names are plural or singular ("Boots", "Dresses"), so try the word as it is
// and without a trailing "s" or "es". "pants" and "jeans" match as they are.
function forms(word: string): string[] {
  const out = [word];
  if (word.endsWith("s")) out.push(word.slice(0, -1));
  if (word.endsWith("es")) out.push(word.slice(0, -2));
  return out;
}

function kindOfWord(word: string): SizeKind | undefined {
  for (const f of forms(word)) {
    const kind = KIND_BY_WORD.get(f);
    if (kind) return kind;
  }
  return undefined;
}

const isAny = (word: string | undefined, list: string[]) =>
  word !== undefined && forms(word).some((f) => list.includes(f));

// "Dress" in front of these describes the item; it isn't a dress size.
const DRESS_MODIFIED = ["sock", "belt", "tie", "watch"];
const SHOE_HEIGHT = ["high", "hi", "low", "mid"];

/**
 * The sizes a gift's name points at, in Settings order: none when it could be
 * anything. Favorite color never shows here; it goes with every kind.
 */
export function sizeKindsFor(giftName: string): SizeKind[] {
  const words = giftName
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const kinds = words.map(kindOfWord);

  const matched = new Set<SizeKind>();
  kinds.forEach((kind, i) => {
    if (!kind) return;
    if (kind === "dress") {
      // "Dress Shirt" / "Dress Shoes" / "Dress Pants" are not dresses; the next
      // word counts on its own. "Dress Socks" and the like match nothing.
      const next = kinds[i + 1];
      if (next === "top" || next === "shoe" || next === "pants") return;
      if (isAny(words[i + 1], DRESS_MODIFIED)) return;
    }
    // "High Top" sneakers are shoes, and a "Cap Toe" oxford is a shoe, not a hat.
    if (kind === "top" && isAny(words[i - 1], SHOE_HEIGHT)) {
      matched.add("shoe");
      return;
    }
    if (words[i] === "cap" && words[i + 1] === "toe") {
      matched.add("shoe");
      return;
    }
    matched.add(kind);
  });
  return SIZE_KINDS.map((k) => k.kind).filter((kind) => matched.has(kind));
}

export function relevantSizes(giftName: string, shared: SharedSize[]): SharedSize[] {
  const matched = new Set(sizeKindsFor(giftName));

  // A name that matches no kind could be anything, so show everything shared.
  // A name that matches shows only its sizes (and color), even if that is none:
  // we know what the gift is, so unrelated sizes would be noise.
  const chosen =
    matched.size === 0
      ? shared
      : shared.filter((s) => matched.has(s.kind) || s.kind === "color");

  const order = SIZE_KINDS.map((k) => k.kind);
  return [...chosen].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
