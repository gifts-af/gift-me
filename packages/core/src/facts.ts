// Profile facts (design §3.1): the categories, and how each reads as one line
// in the extension popup and on the person page (ALL-25).

export type FactCategory =
  | "interest"
  | "dislike"
  | "size"
  | "brand"
  | "owns"
  | "wants"
  | "style"
  | "avoid"
  | "constraint"
  | "loved";

/** What capture extraction may return. "loved" comes only from reactions. */
export const FACT_CATEGORIES_EXTRACTED = [
  "interest",
  "dislike",
  "size",
  "brand",
  "owns",
  "wants",
  "style",
  "avoid",
  "constraint",
] as const satisfies readonly FactCategory[];

const PREFIX: Record<FactCategory, string> = {
  interest: "Into",
  dislike: "Dislikes",
  size: "Size",
  brand: "Likes the brand",
  owns: "Already has",
  wants: "Wants",
  style: "Style",
  avoid: "Avoid",
  constraint: "Needs",
  loved: "Loved",
};

/** "Already has: Owala water bottle". */
export function factLine(category: FactCategory, value: string): string {
  return `${PREFIX[category]}: ${value}`;
}
