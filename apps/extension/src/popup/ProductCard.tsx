import { useEffect, useId, useState } from "react";
import { toCents } from "@gifts-af/core/store-page";
import type { ShownProduct } from "../lib/page";
import { orderCandidates, type PhotoBox } from "../lib/photo";

// The longest name the add route takes (apps/web/modules/lists/lib/save-list.ts MAX_NAME_LENGTH).
const NAME_MAX = 300;
// The photo frame on the card, in CSS pixels (mock-up: 112px square).
const PHOTO_SIZE = 112;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** "$35.00", "$1,024.50". */
export const formatPrice = (cents: number) => usd.format(cents / 100);

/** The typed price in cents, or null when it isn't a price we can save. */
export const parsePrice = (text: string): number | null => toCents(text.trim());

export const initialName = (page: ShownProduct) => (page.product.name ?? "").slice(0, NAME_MAX);
export const initialPrice = (page: ShownProduct) =>
  page.product.priceCents === null ? "" : formatPrice(page.product.priceCents);

/** "rei.com" from the page address. */
export function storeLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The photos ‹ › steps through, product image first; none without a usable screenshot. */
export function photoCandidates(page: ShownProduct): PhotoBox[] {
  if (!page.screenshot || !page.scale) return [];
  return orderCandidates(page.candidates, page.product.imageUrl);
}

/** An object URL for the blob while the component is mounted. */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return blob ? url : null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Shows `box` of the screenshot, fitted inside a size×size square. The
 * screenshot is drawn at the page's CSS width, so this is the same region
 * cropPhoto saves.
 */
export function CropView({
  shotUrl,
  box,
  viewportWidth,
  size,
  label,
}: {
  shotUrl: string | null;
  box: PhotoBox;
  viewportWidth: number;
  size: number;
  label?: string;
}) {
  const k = size / Math.max(box.width, box.height);
  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        width: `${round(box.width * k)}px`,
        height: `${round(box.height * k)}px`,
        backgroundImage: shotUrl ? `url("${shotUrl}")` : undefined,
        backgroundSize: `${round(viewportWidth * k)}px auto`,
        backgroundPosition: `${-round(box.x * k)}px ${-round(box.y * k)}px`,
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

// The product on the page: photo (‹ › to switch), editable name and price, and Add (AC-1 to AC-5).
export function ProductCard({
  page,
  photoIndex,
  onPhotoIndex,
  name,
  onName,
  price,
  onPrice,
  busy,
  onAdd,
}: {
  page: ShownProduct;
  photoIndex: number;
  onPhotoIndex: (index: number) => void;
  name: string;
  onName: (name: string) => void;
  price: string;
  onPrice: (price: string) => void;
  busy: boolean;
  onAdd: () => void;
}) {
  const id = useId();
  const shotUrl = useObjectUrl(page.screenshot);
  const photos = photoCandidates(page);
  const box = photos[photoIndex] ?? null;
  const noPrice = page.product.priceCents === null;
  // Something typed that isn't a price we can save ("35.", "$0"): say why Add is off.
  const badPrice = price.trim() !== "" && parsePrice(price) === null;
  const canAdd = name.trim() !== "" && parsePrice(price) !== null && !busy;
  const priceHints = [noPrice ? `${id}-hint` : null, badPrice ? `${id}-bad` : null].filter(Boolean).join(" ");
  const step = (by: number) => onPhotoIndex((photoIndex + by + photos.length) % photos.length);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-[112px_1fr] gap-3">
        <div className="relative grid h-28 w-28 place-items-center overflow-hidden rounded-lg bg-muted">
          {box ? (
            <CropView shotUrl={shotUrl} box={box} viewportWidth={page.viewportWidth} size={PHOTO_SIZE} label="Product photo" />
          ) : (
            <span className="text-[13px] text-muted-foreground">No photo</span>
          )}
          {photos.length > 1 && (
            <>
              <span className="photo-count">
                {photoIndex + 1} of {photos.length}
              </span>
              <button type="button" className="photo-arrow left-0" aria-label="Previous photo" onClick={() => step(-1)}>
                <span aria-hidden="true">‹</span>
              </button>
              <button type="button" className="photo-arrow right-0" aria-label="Next photo" onClick={() => step(1)}>
                <span aria-hidden="true">›</span>
              </button>
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="field-sm">
            <label htmlFor={`${id}-name`}>Name</label>
            <input
              className="input-sm"
              id={`${id}-name`}
              maxLength={NAME_MAX}
              autoComplete="off"
              value={name}
              onChange={(e) => onName(e.target.value)}
            />
          </div>
          <div className="field-sm">
            <span>
              <label htmlFor={`${id}-price`}>Price</label>
              {noPrice && (
                <span id={`${id}-hint`} className="ml-1 font-normal">
                  Not on the page. Type it in.
                </span>
              )}
            </span>
            <input
              className="input-sm"
              id={`${id}-price`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="$"
              // Lists need a price, so the cursor waits in an empty box (AC-5).
              autoFocus={noPrice}
              aria-describedby={priceHints || undefined}
              aria-invalid={badPrice || undefined}
              value={price}
              onChange={(e) => onPrice(e.target.value)}
            />
            {badPrice && (
              <span id={`${id}-bad`} className="text-xs font-normal text-destructive">
                Type a price like 35.00
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{storeLabel(page.pageUrl)}</span>
        </div>
      </div>
      <button className="btn-primary" type="button" disabled={!canAdd} aria-busy={busy} onClick={onAdd}>
        {busy ? "Adding…" : "Add to my list"}
      </button>
    </div>
  );
}
