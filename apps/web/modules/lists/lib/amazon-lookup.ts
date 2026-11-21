// An Amazon link pasted on My list, looked up through Zinc for its real name,
// price and photo (ALL-141). Amazon answers our server's page reads with a bot
// check, so Zinc's product details call stands in. It costs money on the app's
// own key, so every signed-in person gets a daily allowance (the
// lists.take_amazon_lookup quota) and the amazon_paste_lookup_enabled switch
// turns it off. Everything arrives as an argument (E3): the server action
// builds the quota, the Zinc call, the settings and the logger.
import { errorFields } from "@/lib/log";

export type AmazonProduct = { productId: string; name: string | null; priceCents: number | null; imageUrl: string | null };

export type AmazonLookupResult =
  | { ok: true; product: AmazonProduct }
  | { ok: false; reason: "off" | "not_configured" | "over_limit" | "not_found" | "unavailable" | "bad_asin" | "signed_out" };

export type AmazonLookupSettings = {
  enabled: boolean;
  timeoutMs: number;
  /** zinc_lookup_cents: what one Zinc lookup costs, for the event. */
  lookupCents: number;
};

type Field = string | number | boolean | null;

export type AmazonLookupDeps = {
  /** Takes one lookup from the person's daily allowance; false when it's used up. */
  takeQuota: () => Promise<boolean>;
  /**
   * The concierge's amazonPasteDetails, bound to the app's Zinc key: it takes the quota
   * before calling Zinc. Null when Zinc isn't set up here.
   */
  details:
    | ((
        asin: string,
        takeQuota: () => Promise<boolean>,
        signal?: AbortSignal,
      ) => Promise<{ kind: "found"; product: AmazonProduct } | { kind: "not_found" } | { kind: "over_limit" }>)
    | null;
  log: (event: string, fields: Record<string, Field>) => void;
  now: () => number;
};

const ASIN = /^[A-Z0-9]{10}$/;

export async function lookUpAmazonProduct(
  input: { asin: string; userId: string },
  settings: AmazonLookupSettings,
  deps: AmazonLookupDeps,
): Promise<AmazonLookupResult> {
  const started = deps.now();
  let cents = 0;
  let extra: Record<string, Field> = {};

  const result = await (async (): Promise<AmazonLookupResult> => {
    if (typeof input.asin !== "string" || !ASIN.test(input.asin)) return { ok: false, reason: "bad_asin" };
    if (!settings.enabled) return { ok: false, reason: "off" };
    if (!deps.details) return { ok: false, reason: "not_configured" };
    // A bad timeout setting would hang or fail every call: refuse before anything is spent.
    if (!Number.isInteger(settings.timeoutMs) || settings.timeoutMs <= 0) return { ok: false, reason: "unavailable" };

    // Zinc is called (and billed) only once the allowance is granted.
    const takeQuota = async () => {
      const granted = await deps.takeQuota();
      if (granted) cents = settings.lookupCents;
      return granted;
    };
    try {
      const r = await deps.details(input.asin, takeQuota, AbortSignal.timeout(settings.timeoutMs));
      if (r.kind === "over_limit") return { ok: false, reason: "over_limit" };
      if (r.kind === "not_found") return { ok: false, reason: "not_found" };
      return { ok: true, product: r.product };
    } catch (e) {
      extra = errorFields(e);
      return { ok: false, reason: "unavailable" };
    }
  })();

  // Ids only (E6): no ASIN, no product name.
  deps.log("list.amazon_lookup", {
    user_id: input.userId,
    outcome: result.ok ? "ok" : result.reason,
    cents,
    ms: deps.now() - started,
    ...extra,
  });
  return result;
}
