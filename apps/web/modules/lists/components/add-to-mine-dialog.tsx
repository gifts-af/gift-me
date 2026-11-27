"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// The first "Add to my list" on a friend's list explains itself, so nobody mistakes it for
// claiming the gift. Shown once per device; after that the link just adds.

const SEEN_KEY = "giftsaf:add-to-mine-explained";

export function addToMineExplained(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberAddToMineExplained() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Private mode: they'll see the explanation again, which is harmless.
  }
}

type Props = {
  /** The gift being added; null when the dialog is closed. */
  giftName: string | null;
  /** Whose list this is, for "It doesn't claim it for Sam"; null when unnamed. */
  ownerName: string | null;
  /** Signed out: adding starts with making an account. */
  signedOut: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function AddToMineDialog({ giftName, ownerName, signedOut, onConfirm, onCancel }: Props) {
  const them = ownerName ?? "them";
  return (
    <Dialog open={giftName !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add it to your own list?</DialogTitle>
          <DialogDescription>
            This puts the {giftName} on <strong>your</strong> wish list, so people can get it for you. It doesn&apos;t
            claim or buy it for {them}.
          </DialogDescription>
        </DialogHeader>
        <p className="text-[15px]">
          To get it <em>for</em> {them}, tap <strong>Claim</strong> instead.
          {signedOut && " Adding it starts with a free account."}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="button" onClick={onConfirm}>
            {signedOut ? "Sign up and add it" : "Add to my list"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
