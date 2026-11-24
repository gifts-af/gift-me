/**
 * A stored store name as people read it: "Amazon" from "amazon", "Etsy" from "etsy.com".
 * A plain .com shows its name; any other domain stays as it is.
 */
export function storeLabel(stored: string | null): string | null {
  if (!stored) return null;
  const name = /^([^.]+)\.com$/.exec(stored)?.[1] ?? stored;
  return name.includes(".") ? name : name.charAt(0).toUpperCase() + name.slice(1);
}
