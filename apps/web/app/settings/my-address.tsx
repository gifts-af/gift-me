"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Address } from "@gifts-af/core";
import { AddressForm, type AddressValues } from "@/components/address/address-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { AccountAddressResult, MyAddress } from "@/lib/account-address";

const EMPTY: AddressValues = { firstName: "", lastName: "", line1: "", line2: "", city: "", state: "", zip: "" };
const PAST_ORDERS = "Past orders keep the address they shipped to.";
const TRY_AGAIN = "That didn't save. Try again.";

function startValues(address: MyAddress): AddressValues {
  return address.kind === "saved" ? { ...address.address, line2: address.address.line2 ?? "" } : EMPTY;
}

/** Your own address in Settings (ALL-63, decision 41). Sharing is switched on the list page. */
export function MyAddressSection({
  address,
  saveAction,
  removeAction,
}: {
  address: MyAddress;
  saveAction: (form: FormData) => Promise<AccountAddressResult>;
  removeAction: () => Promise<AccountAddressResult>;
}) {
  const [editing, setEditing] = useState(false);
  const section = useRef<HTMLElement>(null);

  // Next keeps visited routes in the page, hidden, with their state: close the
  // form on leaving, so coming back shows the saved card.
  useLayoutEffect(() => () => setEditing(false), []);

  // The section renders inside Suspense, after the browser has looked for the anchor.
  useEffect(() => {
    if (window.location.hash === "#my-address") section.current?.scrollIntoView?.({ block: "start" });
  }, []);

  return (
    <section ref={section} id="my-address" className="flex scroll-mt-4 flex-col gap-1.5" aria-labelledby="my-address-heading">
      <h2 id="my-address-heading" className="text-sm font-semibold">
        My address
      </h2>
      {address.kind === "unavailable" ? (
        <p className="text-[13px] text-muted-foreground">We couldn&apos;t load your address. Try again.</p>
      ) : editing ? (
        <AddressForm start={startValues(address)} submitLabel="Save address" save={saveAction} onDone={() => setEditing(false)} />
      ) : address.kind === "saved" ? (
        <SavedAddress address={address.address} shared={address.shared} onChange={() => setEditing(true)} removeAction={removeAction} />
      ) : (
        <>
          <Note />
          <Button type="button" variant="outline" className="self-start" onClick={() => setEditing(true)}>
            Add my address
          </Button>
        </>
      )}
    </section>
  );
}

function Note() {
  return (
    <p className="text-[13px] text-muted-foreground">
      Only you can see this here. It&apos;s used only if you let people with your list ship gifts to you.
    </p>
  );
}

function SavedAddress({
  address,
  shared,
  onChange,
  removeAction,
}: {
  address: Address;
  shared: boolean;
  onChange: () => void;
  removeAction: () => Promise<AccountAddressResult>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    let result: AccountAddressResult;
    try {
      result = await removeAction();
    } catch {
      result = { ok: false, error: TRY_AGAIN };
    }
    setBusy(false);
    if (result.ok) setOpen(false);
    else setError(result.error);
  }

  return (
    <>
      <div className="rounded-xl border border-border p-3 text-[15px]">
        <p>
          {address.firstName} {address.lastName}
        </p>
        <p>{[address.line1, address.line2].filter(Boolean).join(", ")}</p>
        <p>
          {address.city}, {address.state} {address.zip}
        </p>
      </div>
      <div className="flex items-center justify-between">
        <Button type="button" variant="link" className="px-0 text-primary" onClick={onChange}>
          Change address
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="link" className="px-0 text-muted-foreground">
              Remove
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove your address?</DialogTitle>
              <DialogDescription>
                {shared
                  ? `People with your list won't be able to ship gifts to you until you add it and turn sharing on again. ${PAST_ORDERS}`
                  : PAST_ORDERS}
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="text-[13px] text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()}>
                Remove address
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {shared ? "Shared with people who have your list." : "Not shared."}{" "}
        <Link href="/lists" className="inline-flex min-h-11 items-center text-primary underline underline-offset-[3px]">
          Change this on your list.
        </Link>
      </p>
    </>
  );
}
