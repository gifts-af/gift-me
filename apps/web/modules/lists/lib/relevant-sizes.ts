import { SIZE_KINDS, type SharedSize, type SizeKind } from "@/lib/size-kinds";

// Whole-word lists per kind. A wrong hit only adds a line (a "Ring Light" shows
// ring size), so these favour catching the common store words over precision.
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
function kindOfWord(word: string): SizeKind | undefined {
  const candidates = [word];
  if (word.endsWith("s")) candidates.push(word.slice(0, -1));
  if (word.endsWith("es")) candidates.push(word.slice(0, -2));
  for (const c of candidates) {
    const kind = KIND_BY_WORD.get(c);
    if (kind) return kind;
  }
  return undefined;
}

export function relevantSizes(giftName: string, shared: SharedSize[]): SharedSize[] {
  const words = giftName
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const kinds = words.map(kindOfWord);

  const matched = new Set<SizeKind>();
  kinds.forEach((kind, i) => {
    if (!kind) return;
    // "Dress Shirt" / "Dress Shoes" / "Dress Pants" are not dresses; the next
    // word counts on its own.
    if (kind === "dress") {
      const next = kinds[i + 1];
      if (next === "top" || next === "shoe" || next === "pants") return;
    }
    matched.add(kind);
  });

  // Nothing recognised, or nothing recognised that is shared: show everything,
  // since a missing line costs more than an extra one.
  const hits = shared.filter((s) => matched.has(s.kind));
  const chosen = hits.length > 0 ? shared.filter((s) => matched.has(s.kind) || s.kind === "color") : shared;

  const order = SIZE_KINDS.map((k) => k.kind);
  return [...chosen].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
