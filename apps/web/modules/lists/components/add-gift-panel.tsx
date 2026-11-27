import { Button } from "@/components/ui/button";
import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { lookupProductLink, storeName, type MissingField } from "@/modules/lists/lib/product-link";
import { centsToInputValue, parsePriceToCents } from "@/modules/lists/lib/format";
import type { PageProduct } from "@gifts-af/core/store-page";
import { useExtensionStoreUrl } from "@/components/extension-link";
import type { AmazonLookupResult, AmazonProduct } from "@/modules/lists/lib/amazon-lookup";
import type { ReadPage } from "@/modules/lists/lib/gift-link";
import type { Gift } from "@/modules/lists/lib/lists";
import LookupStatus, { type Lookup, type LookupProduct } from "./lookup-status";
import { inputClass, labelClass } from "./ui";
import { useHydrated } from "@/lib/use-hydrated";

// The editable fields, held as typed: the price stays a string until submit.
type Draft = { name: string; price: string; imageUrl: string };
type FieldErrors = Partial<Record<keyof Draft, string>>;
// Where the gift came from, carried through to onAdd untouched.
type Meta = Pick<Gift, "productUrl" | "asin" | "source">;
type Mode = "closed" | "details";
// What the panel last said: a gift added, or why a lookup was held back.
type Announcement = { text: string; tone: "done" | "hold" };
// A lookup that found a product, complete or partial.
type FoundLookup = Exclude<Lookup, { status: "error" }>;

/** What a confirmed gift hands up: a Gift before it gets an id and a date. */
export type NewGift = Omit<Gift, "id" | "addedAt">;

export type AddGiftPanelProps = {
  onAdd: (gift: NewGift) => void;
  readStorePage?: ReadPage;
  lookUpAmazon?: (asin: string) => Promise<AmazonLookupResult>;
};

type ImagePreviewProps = { src: string };

type FieldErrorProps = { id: string; children: ReactNode };

const EMPTY_DRAFT: Draft = { name: "", price: "", imageUrl: "" };
const EMPTY_META: Meta = { productUrl: null, asin: null, source: "manual" };

function ImagePreview({ src }: ImagePreviewProps) {
  const [failed, setFailed] = useState(false);
  if (!src.trim()) return null;
  if (failed) {
    return (
      <span className="grid size-11 flex-none place-items-center rounded-md bg-muted text-[13px]" aria-hidden="true">
        n/a
      </span>
    );
  }
  return (
    <img
      className="size-11 flex-none rounded-md object-contain"
      src={src}
      alt="Preview of the gift image"
      // Amazon returns a 1x1 GIF placeholder (HTTP 200) for ASINs it lacks a
      // photo for, so onError never fires -- catch it via naturalWidth.
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth <= 1) setFailed(true);
      }}
      onError={() => setFailed(true)}
    />
  );
}

function FieldError({ id, children }: FieldErrorProps) {
  return (
    <p className="text-[13px] font-normal text-destructive" id={id}>
      {children}
    </p>
  );
}

/**
 * Merges what the server read off a store page (ALL-10) into the link-only
 * result. The page's name beats the one guessed from the link.
 */
function withStorePage(result: FoundLookup, page: PageProduct): Lookup {
  const product: LookupProduct = {
    ...result.product,
    name: page.name ?? result.product.name,
    priceCents: page.priceCents,
    imageUrl: page.imageUrl,
    source: "store-page",
    pageRead: true,
  };
  return withMissing(product);
}

// Amazon (ALL-141): the link already gives a name from its path and a photo
// guessed from the ASIN, which Amazon answers with a blank 1x1 for newer
// products. Zinc's name and photo win, and the link's stay where Zinc has
// none. The price is Zinc's only: a fixture's stand-in price never outlives a
// real lookup.
//
// An answer for a different product (Zinc's productId isn't this ASIN) is
// ignored.
function withAmazonProduct(result: FoundLookup, page: AmazonProduct): Lookup {
  if (typeof page.productId !== "string" || page.productId.toUpperCase() !== result.product.asin) return result;
  const product: LookupProduct = {
    ...result.product,
    name: page.name ?? result.product.name,
    priceCents: page.priceCents,
    imageUrl: page.imageUrl ?? result.product.imageUrl,
    source: "amazon-zinc",
    store: storeName(result.product.productUrl),
    pageRead: true,
    pageFound: { name: page.name !== null, image: page.imageUrl !== null },
  };
  return withMissing(product);
}

function withMissing(product: LookupProduct): Lookup {
  const missing: MissingField[] = [];
  if (!product.name) missing.push("name");
  if (product.priceCents === null) missing.push("priceCents");
  return { status: missing.length === 0 ? "complete" : "partial", product, missing, error: null };
}

function isAmazonSource(source: LookupProduct["source"] | null): boolean {
  return source === "amazon-url" || source === "amazon-fixture";
}

/**
 * Paste a link and tap Add (mock-up "list"): a full match is added to the
 * list straight away; a partial one opens the details, prefilled, at the
 * missing field, and holds there until it's added or cancelled.
 * "Add by hand" opens the same details empty.
 *
 * When signed in, the server fills the name, price and photo:
 * `readStorePage(url)` reads another store's page, and `lookUpAmazon(asin)`
 * looks an Amazon product up through Zinc (ALL-141; Amazon blocks our page
 * reads). Without them, or when either comes back empty, only what's in the
 * link is used.
 */
export default function AddGiftPanel({ onAdd, readStorePage, lookUpAmazon }: AddGiftPanelProps) {
  const hydrated = useHydrated();
  const [url, setUrl] = useState("");
  // Every field is seeded with '' and never undefined, so React never has to
  // switch an input from uncontrolled to controlled when autofill lands.
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [meta, setMeta] = useState(EMPTY_META);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [announcement, setAnnouncement] = useState<Announcement>({ text: "", tone: "done" });
  // 'closed' | 'details' (the editable fields)
  const [mode, setMode] = useState<Mode>("closed");
  const storeUrl = useExtensionStoreUrl();

  // Discards out-of-order lookups: paste A, add, paste B, add -- A's response
  // must not land on top of B's.
  const requestId = useRef(0);
  const urlRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  function setField(field: keyof Draft, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  // Focus has to wait for the fields to render after a mode change, so it's
  // queued here and applied straight after that render -- never on a timer,
  // which could pull a fast typist out of the field they'd moved to.
  const pendingFocus = useRef<RefObject<HTMLElement | null>>(null);
  function focusSoon(ref: RefObject<HTMLElement | null>) {
    pendingFocus.current = ref;
  }
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current.current?.focus();
    pendingFocus.current = null;
  });

  async function handleAutofill() {
    const myRequest = ++requestId.current;
    setPending(true);
    setAnnouncement({ text: "", tone: "done" });

    let result: Lookup;
    try {
      result = await lookupProductLink(url);
    } catch {
      result = {
        status: "error",
        product: null,
        missing: [],
        error: { code: "NETWORK_ERROR", message: "That lookup failed. Try again." },
      };
    }

    const source = result.status === "error" ? null : result.product.source;
    try {
      if (lookUpAmazon && result.status !== "error" && result.product.asin && isAmazonSource(source)) {
        const found = await lookUpAmazon(result.product.asin);
        if (found?.ok) result = withAmazonProduct(result, found.product);
      } else if (readStorePage && result.status !== "error" && source === "store-url") {
        const page = await readStorePage(result.product.productUrl);
        if (page?.ok) result = withStorePage(result, page.product);
      }
    } catch {
      // Keep the link-only result: the person can still add it by hand.
    }

    if (myRequest !== requestId.current) return; // superseded
    setPending(false);

    if (result.status === "error") {
      setLookup(result);
      // Leave the fields alone -- a failed lookup must never wipe typed input.
      urlRef.current?.focus();
      return;
    }

    const { product } = result;
    if (result.status === "complete" && product.name && product.priceCents !== null) {
      // A full match is saved in one tap: a second confirm step read as already
      // saved, and the next paste replaced it.
      add(product.name, product.priceCents, product.imageUrl ?? "", {
        productUrl: product.productUrl,
        asin: product.asin,
        source: product.source,
      });
      return;
    }

    // A new link is a new gift: start from an empty draft so nothing from an
    // earlier link or typed value survives, including fields added later (ALL-91).
    setLookup(result);
    setDraft({
      ...EMPTY_DRAFT,
      name: product.name ?? "",
      price: product.priceCents === null ? "" : centsToInputValue(product.priceCents),
      imageUrl: product.imageUrl ?? "",
    });
    setMeta({ productUrl: product.productUrl, asin: product.asin, source: product.source });
    setErrors({});

    // Land the cursor on the first thing still needed.
    setMode("details");
    focusSoon(result.missing.includes("name") ? nameRef : priceRef);
  }

  function lookUpLink() {
    // A half-finished gift from a link is never replaced by the next one; an
    // empty or typed "Add by hand" draft is (ALL-91).
    if (mode === "details" && meta.productUrl !== null) {
      setAnnouncement({ text: "Finish adding this one first, or tap Cancel.", tone: "hold" });
      return;
    }
    handleAutofill();
  }

  function add(name: string, priceCents: number, imageUrl: string, from: Meta) {
    onAdd({
      name,
      priceCents,
      imageUrl: imageUrl.trim() || null,
      productUrl: from.productUrl,
      asin: from.asin,
      source: from.source,
    });
    clear();
    setAnnouncement({ text: `Added ${name} to your list.`, tone: "done" });
    urlRef.current?.focus();
  }

  function clear() {
    setUrl("");
    setDraft(EMPTY_DRAFT);
    setMeta(EMPTY_META);
    setLookup(null);
    setErrors({});
    setMode("closed");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Validate the draft unconditionally: autofill may have been edited since,
    // so where the data came from is irrelevant here.
    const name = draft.name.trim();
    const priceCents = parsePriceToCents(draft.price);
    const nextErrors: FieldErrors = {};

    if (!name) nextErrors.name = "Give the gift a name.";
    if (draft.price.trim() === "") nextErrors.price = "Add a price.";
    else if (priceCents === null) nextErrors.price = "Enter a price like 24.99.";

    if (Object.keys(nextErrors).length > 0 || priceCents === null) {
      setErrors(nextErrors);
      setMode("details");
      focusSoon(nextErrors.name ? nameRef : priceRef);
      return;
    }

    add(name, priceCents, draft.imageUrl, meta);
  }

  return (
    <section className="flex flex-col gap-3 lg:max-w-xl" aria-label="Add a gift">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
        <div className="flex items-end gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor="product-url" className={labelClass}>
              Paste a link
            </label>
            <input
              id="product-url"
              ref={urlRef}
              type="text"
              disabled={!hydrated}
              inputMode="url"
              autoComplete="off"
              placeholder="amazon.com, walmart.com, target.com…"
              className={inputClass}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                // After pasting a link, Enter should mean "look it up".
                if (event.key === "Enter") {
                  event.preventDefault();
                  lookUpLink();
                }
              }}
            />
          </div>
          {/* type="button" is essential: the default is submit, and being the
              first button in the form it would become the implicit Enter target. */}
          <Button type="button" variant="secondary" onClick={lookUpLink} disabled={pending} aria-busy={pending}>
            {pending ? "Looking…" : "Add"}
          </Button>
        </div>
        <LookupStatus lookup={lookup} pending={pending} />
        {/* Visible, not only announced, so a sighted person sees a one-tap add landed. */}
        <p
          className={`text-[13px] font-semibold [overflow-wrap:anywhere] empty:hidden ${announcement.tone === "done" ? "text-success" : "text-warning"}`}
          role="status"
          aria-live="polite"
        >
          {announcement.text}
        </p>
        {/* Desktop Chrome only, and only before a gift is under way (ALL-65). */}
        {storeUrl && mode === "closed" && !lookup && !pending && (
          <p className="text-[13px] text-muted-foreground">
            Shopping elsewhere?{" "}
            <a
              href={storeUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-primary underline-offset-2 hover:underline"
            >
              Save from any shop with the extension
            </a>
          </p>
        )}

        {mode !== "details" && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-1 self-start"
            onClick={() => {
              setMode("details");
              focusSoon(nameRef);
            }}
          >
            Add by hand
          </Button>
        )}

        {mode === "details" && (
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Gift details</legend>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="gift-name" className={labelClass}>
                Gift name
              </label>
              <input
                id="gift-name"
                ref={nameRef}
                type="text"
                className={inputClass}
                value={draft.name}
                onChange={(event) => setField("name", event.target.value)}
                aria-invalid={errors.name ? "true" : undefined}
                aria-describedby={errors.name ? "gift-name-error" : undefined}
              />
              {errors.name && <FieldError id="gift-name-error">{errors.name}</FieldError>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="gift-price" className={labelClass}>
                Price
              </label>
              <div className="relative max-w-40">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true">
                  $
                </span>
                {/* Held as the raw typed string and converted only on submit: round
                    -tripping through a formatter rewrites "12." and jumps the caret. */}
                <input
                  id="gift-price"
                  ref={priceRef}
                  type="text"
                  inputMode="decimal"
                  placeholder="24.99"
                  className={`${inputClass} num pl-7`}
                  value={draft.price}
                  onChange={(event) => setField("price", event.target.value)}
                  aria-invalid={errors.price ? "true" : undefined}
                  aria-describedby={errors.price ? "gift-price-error" : undefined}
                />
              </div>
              {errors.price && <FieldError id="gift-price-error">{errors.price}</FieldError>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="gift-image" className={labelClass}>
                Image URL <span className="font-normal text-muted-foreground">Optional</span>
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="gift-image"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://…"
                  className={inputClass}
                  value={draft.imageUrl}
                  onChange={(event) => setField("imageUrl", event.target.value)}
                />
                {/* key resets the preview's failure flag whenever the URL changes. */}
                <ImagePreview key={draft.imageUrl} src={draft.imageUrl} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" variant="secondary">
                Add to list
              </Button>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="px-1"
                onClick={() => {
                  setAnnouncement({ text: "", tone: "done" });
                  // A draft from a link goes with its link; "Add by hand" closes as before.
                  if (meta.productUrl !== null) {
                    clear();
                  } else {
                    setMode("closed");
                    setErrors({});
                  }
                }}
              >
                Cancel
              </Button>
            </div>
          </fieldset>
        )}
      </form>
    </section>
  );
}
