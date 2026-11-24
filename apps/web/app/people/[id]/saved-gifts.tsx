"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Saved gifts for someone (ALL-93, planning decision 54): gifts the buyer
// spotted, kept on this page. Only the buyer ever sees them.

type Result = { ok: true } | { ok: false; error: string };
type Action = (previous: null, formData: FormData) => Promise<Result>;
type LinkRead =
  | { ok: true; name: string | null; priceCents: number | null; imageUrl: string | null; productUrl: string }
  | { ok: false; error: string };

export type ShownGift = {
  id: string;
  name: string;
  priceCents: number | null;
  productUrl: string | null;
  imageUrl: string | null;
  /** The store's name, worked out from the link on the server ("Amazon"). */
  store: string | null;
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const EMPTY = { link: "", name: "", price: "", image: "" };

function priceLine(gift: ShownGift): string {
  const price = gift.priceCents === null ? "No price" : money.format(gift.priceCents / 100);
  return gift.store ? `${price} · ${gift.store}` : price;
}

// A link worth reading: a web address with a dot in its host.
function looksLikeLink(value: string): boolean {
  return /^(https?:\/\/)?[^\s/]+\.[^\s/]+/i.test(value.trim());
}

export function SavedGifts({
  personId,
  name,
  gifts,
  readAction,
  saveAction,
  removeAction,
}: {
  personId: string;
  name: string;
  gifts: ShownGift[];
  /** `readGiftLinkAction` */
  readAction: (url: string) => Promise<LinkRead>;
  /** `saveGiftAction` */
  saveAction: Action;
  /** `removeSavedGiftAction` */
  removeAction: Action;
}) {
  const [draft, setDraft] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Each edit of the link, each read and each save bumps this; a read that
  // comes back to an older number is dropped, so it can't refill a form that
  // moved on.
  const latest = useRef(0);
  // The link is read once: when it's pasted, or when the buyer leaves the
  // field, never on every keystroke (each read can fetch a store's page).
  const pasted = useRef(false);
  const lastRead = useRef("");
  // What the last read filled in, so a new link can replace it but never
  // what the buyer typed.
  const filled = useRef({ name: "", price: "" });

  async function readLink(link: string) {
    lastRead.current = link;
    if (!looksLikeLink(link)) return;
    const mine = ++latest.current;
    let read: LinkRead;
    try {
      read = await readAction(link);
    } catch {
      return;
    }
    if (mine !== latest.current || !read.ok) return;
    const name = read.name ?? "";
    const price = read.priceCents === null ? "" : (read.priceCents / 100).toFixed(2);
    setDraft((d) => {
      const next = { ...d, name: d.name || name, price: d.price || price, image: read.imageUrl ?? "" };
      filled.current = { name: d.name ? "" : name, price: d.price ? "" : price };
      return next;
    });
  }

  function changeLink(link: string) {
    latest.current++;
    // A new link starts over: what the old one filled in, and its photo, go.
    const was = filled.current;
    filled.current = { name: "", price: "" };
    setDraft((d) => ({
      ...d,
      link,
      name: was.name && d.name === was.name ? "" : d.name,
      price: was.price && d.price === was.price ? "" : d.price,
      image: "",
    }));
    if (pasted.current) {
      pasted.current = false;
      void readLink(link);
    }
  }

  async function run(action: Action, form: FormData): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    let result: Result;
    try {
      result = await action(null, form);
    } catch {
      result = { ok: false, error: "That didn't save. Try again." };
    }
    setBusy(false);
    if (!result.ok) setError(result.error);
    return result.ok;
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="saved-gifts-heading">
      <div className="flex flex-col gap-1">
        <h2 id="saved-gifts-heading" className="text-lg font-semibold">
          Saved gifts
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Only you see these. {name} never does.
        </p>
      </div>

      <form
        className="flex flex-col gap-3 rounded-xl border border-border p-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          // From the fields themselves: text typed before the page was ready never reached state.
          const form = new FormData(e.currentTarget);
          form.set("id", personId);
          latest.current++;
          void run(saveAction, form).then((saved) => {
            if (saved) setDraft(EMPTY);
          });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="saved-gift-link">Link</Label>
          <Input
            id="saved-gift-link"
            name="link"
            placeholder="Paste a link to a gift, or leave empty"
            autoComplete="off"
            inputMode="url"
            value={draft.link}
            onPaste={() => {
              pasted.current = true;
            }}
            onChange={(e) => changeLink(e.target.value)}
            onBlur={(e) => {
              if (e.target.value !== lastRead.current) void readLink(e.target.value);
            }}
          />
        </div>
        <div className="flex gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="saved-gift-name">Gift</Label>
            <Input
              id="saved-gift-name"
              name="name"
              autoComplete="off"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>
          <div className="flex w-28 flex-col gap-1.5">
            <Label htmlFor="saved-gift-price">Price</Label>
            <Input
              id="saved-gift-price"
              name="price"
              inputMode="decimal"
              autoComplete="off"
              placeholder="$"
              value={draft.price}
              onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
            />
          </div>
        </div>
        <input type="hidden" name="image" value={draft.image} />
        <Button type="submit" className="self-start" disabled={busy}>
          Save
        </Button>
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
      </form>

      {gifts.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Keep gifts you spot for {name} here.</p>
      ) : (
        <ul className="flex flex-col">
          {gifts.map((gift) => (
            <li key={gift.id} className="flex items-center gap-3 border-t border-border py-2 first:border-t-0">
              {gift.imageUrl ? (
                // A store's photo, like the gift cards on My list.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={gift.imageUrl} alt="" referrerPolicy="no-referrer" className="size-12 shrink-0 rounded-md bg-muted object-contain" />
              ) : (
                <div className="size-12 shrink-0 rounded-md bg-muted" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                {gift.productUrl ? (
                  <a
                    href={gift.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block min-h-11 content-center break-words font-medium underline-offset-2 hover:underline"
                  >
                    {gift.name}
                  </a>
                ) : (
                  <p className="break-words font-medium">{gift.name}</p>
                )}
                <p className="text-[13px] text-muted-foreground">{priceLine(gift)}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                aria-label={`Remove ${gift.name}`}
                disabled={busy}
                onClick={() => {
                  const form = new FormData();
                  form.set("id", personId);
                  form.set("gift", gift.id);
                  void run(removeAction, form);
                }}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
