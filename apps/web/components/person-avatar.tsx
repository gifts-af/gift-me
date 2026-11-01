import { cn } from "@/lib/utils";

// Soft tint + matching text, all from the existing tokens.
const TINTS = [
  "bg-accent text-accent-foreground",
  "bg-success-soft text-success",
  "bg-warning-soft text-warning",
  "bg-secondary text-secondary-foreground",
];

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
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
}: {
  name: string;
  photoUrl: string | null;
  /** Width and height in pixels. */
  size: number;
  className?: string;
}) {
  const box = { width: size, height: size };
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, already resized
    return <img src={photoUrl} alt={name} style={box} className={cn("shrink-0 rounded-full object-cover", className)} />;
  }
  return (
    <span
      role="img"
      aria-label={name}
      style={{ ...box, fontSize: Math.round(size * 0.4) }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", tintFor(name), className)}
    >
      {initialsOf(name)}
    </span>
  );
}
