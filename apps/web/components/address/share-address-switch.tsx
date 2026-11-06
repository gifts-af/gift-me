"use client";

import Link from "next/link";
import { useLayoutEffect, useState, useTransition } from "react";
import { AddressForm, type AddressValues } from "@/components/address/address-form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AccountAddressResult, Sharing } from "@/lib/account-address";

const EMPTY: AddressValues = { firstName: "", lastName: "", line1: "", line2: "", city: "", state: "", zip: "" };
const ZINC = "The person ordering may be able to see your full address in their Zinc account.";
const TRY_AGAIN = "That didn't save. Try again.";

/**
 * "Let people with my list ship gifts to me" (ALL-63, T61). Whether it's on
 * always comes from `sharing`, what's saved: a route can come back from hidden,
 * and copying it into state would show a stale switch.
 */
export function ShareAddressSwitch({
  sharing,
  saveAction,
  setSharingAction,
}: {
  sharing: Sharing;
  saveAction: (form: FormData) => Promise<AccountAddressResult>;
  setSharingAction: (on: boolean) => Promise<AccountAddressResult>;
}) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Next keeps visited routes in the page, hidden, with their state: leave no
  // old message or open dialog for coming back to.
  useLayoutEffect(
    () => () => {
      setError(null);
      setAsking(false);
    },
    [],
  );

  if (sharing.kind === "unavailable") return null;

  function change(on: boolean) {
    setError(null);
    if (sharing.kind === "none") {
      setAsking(true);
      return;
    }
    startTransition(async () => {
      try {
        const result = await setSharingAction(on);
        if (!result.ok) setError(result.error);
      } catch {
        setError(TRY_AGAIN);
      }
    });
  }

  return (
    <section className="flex gap-3 rounded-xl border border-border p-3" aria-label="Sharing your address">
      <Switch
        id="share-address"
        className="mt-0.5"
        checked={sharing.kind === "on"}
        disabled={pending}
        onCheckedChange={change}
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="share-address" className="text-[15px] font-semibold">
          Let people with my list ship gifts to me
        </Label>
        {sharing.kind === "on" ? (
          <p className="text-[13px] text-muted-foreground">
            They see {sharing.city}, {sharing.state} in GiftsAF. {ZINC}{" "}
            <Link href="/settings#my-address" className="text-primary underline underline-offset-[3px]">
              Change my address
            </Link>
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Anyone with your list link can see your city and state in GiftsAF. {ZINC}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
      </div>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Where should gifts ship?</DialogTitle>
            <DialogDescription>Saving this turns sharing on.</DialogDescription>
          </DialogHeader>
          <AddressForm
            start={EMPTY}
            submitLabel="Save and share"
            save={(form) => {
              form.set("share", "1");
              return saveAction(form);
            }}
            onDone={() => setAsking(false)}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
