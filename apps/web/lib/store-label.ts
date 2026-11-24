/**
 * A stored store name as people read it: "Amazon" from "amazon", "Etsy" from "etsy.com".
 * Any other domain stays as it is, since a part of it would be a guess.
 */
export function storeLabel(stored: string | null): string | null {
  if (!stored) return null;
  const name = /^([^.]+)\.com$/.exec(stored)?.[1] ?? stored;
  return name.includes(".") ? name : name.charAt(0).toUpperCase() + name.slice(1);
}
