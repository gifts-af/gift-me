// Browser-safe on purpose: no imports, so client components can use it.
export const SIZE_KINDS = [
  { kind: "top", label: "Shirt or top" },
  { kind: "pants", label: "Pants" },
  { kind: "dress", label: "Dress" },
  { kind: "shoe", label: "Shoe" },
  { kind: "ring", label: "Ring" },
  { kind: "hat", label: "Hat" },
  { kind: "color", label: "Favorite color" },
] as const;

export type SizeKind = (typeof SIZE_KINDS)[number]["kind"];

export type SharedSize = { kind: SizeKind; value: string };
