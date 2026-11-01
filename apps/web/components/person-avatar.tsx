"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Soft tint + matching text, all from the existing tokens.
const TINTS = [
  "bg-accent text-accent-foreground",
  "bg-success-soft text-success",
  "bg-warning-soft text-warning",
  "bg-secondary text-secondary-foreground",
];

export function initialsOf(name: string): string {
  // Words of letters only, so quotes and symbols ("'Donald Allen'", "#BAL")
  // don't become initials (ALL-72). No letters at all: the first character.
  const words = name.match(/[\p{L}\p{N}]+/gu)?.filter((w) => /\p{L}/u.test(w)) ?? [];
  if (words.length === 0) return Array.from(name.trim())[0] ?? "";
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0].toUpperCase())
    .join("");
}

// Same name, same color, every time.
function tintFor(name: string): string {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return TINTS[hash % TINTS.length];
}

export function PersonAvatar({
  name,
  photoUrl,
  size,
  className,
  decorative = false,
}: {
  name: string;
  photoUrl: string | null;
  /** Width and height in pixels. */
  size: number;
  className?: string;
  /** True when the name is already shown beside it, so screen readers skip it. */
  decorative?: boolean;
}) {
  // Signed links expire; a photo that fails to load falls back to initials.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const box = { width: size, height: size };
  if (photoUrl && photoUrl !== failedUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, already resized
    return <img src={photoUrl} alt={decorative ? "" : name} onError={() => setFailedUrl(photoUrl)} style={box} className={cn("shrink-0 rounded-full object-cover", className)} />;
  }
  return (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
      style={{ ...box, fontSize: Math.round(size * 0.4) }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", tintFor(name), className)}
    >
      {initialsOf(name)}
    </span>
  );
}
