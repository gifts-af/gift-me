import type { LinkedProduct, LookupResult, MissingField } from "@/modules/lists/lib/product-link";

/**
 * A link's product, plus what the server read of its store page or Amazon's
 * lookup added: which source won, and which details the page itself gave.
 */
export type LookupProduct = Omit<LinkedProduct, "source"> & {
  source: LinkedProduct["source"] | "store-page" | "amazon-zinc";
  pageRead?: boolean;
  pageFound?: { name: boolean; image: boolean };
};

/** The link lookup's result, with the product widened to what a page read adds. */
export type Lookup =
  | Extract<LookupResult, { status: "error" }>
  | { status: "complete" | "partial"; product: LookupProduct; missing: MissingField[]; error: null };

export type LookupStatusProps = { lookup: Lookup | null; pending: boolean };

export default function LookupStatus({ lookup, pending }: LookupStatusProps) {
  if (pending) {
    return (
      <p className="text-[13px] text-muted-foreground" role="status">
        Looking up that link…
      </p>
    );
  }

  if (!lookup) return null;

  if (lookup.status === "error") {
    // Assertive, because the paste the user just made did not work.
    return (
      <p className="text-[13px] text-destructive" role="alert">
        {lookup.error.message}
      </p>
    );
  }

  // A full match is added straight away, so it has nothing to say here.
  if (lookup.status === "complete") return null;

  const needsName = lookup.missing.includes("name");
  // Only what the page itself gave: an Amazon read keeps the link's name and
  // guessed photo where the page has none (ALL-141).
  const found = lookup.product.pageFound ?? {
    name: Boolean(lookup.product.name),
    image: Boolean(lookup.product.imageUrl),
  };
  const got = lookup.product.pageRead ? [found.name && "the name", found.image && "the photo"].filter(Boolean) : [];
  if (got.length > 0 && !lookup.missing.includes("name")) {
    return (
      <p className="text-[13px] text-warning" role="status">
        Got {got.join(" and ")} from {lookup.product.store}. {lookup.product.store} doesn’t show us the price, so add it below.
      </p>
    );
  }
  if (lookup.product.source === "store-url" || lookup.product.pageRead) {
    return (
      <p className="text-[13px] text-warning" role="status">
        {needsName ? "Saved the link." : "Got the name from that link."} We can’t read prices from {lookup.product.store} yet, so{" "}
        {needsName ? "name it and add the price" : "add the price"} below.
      </p>
    );
  }
  return (
    <p className="text-[13px] text-warning" role="status">
      Got the image{needsName ? "" : " and the name"} from that link. Amazon doesn’t share prices with browsers, so{" "}
      {needsName ? "name it and add the price" : "add the price"} below.
    </p>
  );
}
