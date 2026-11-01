"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { SaveResult } from "@/modules/concierge";

/** Delete sits at the very bottom, behind a confirm. Afterwards: Home. */
export function DeletePerson({
  personId,
  name,
  action,
}: {
  personId: string;
  name: string;
  /** `deletePersonAction` */
  action: (previous: null, formData: FormData) => Promise<SaveResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("id", personId);
    let result: SaveResult;
    try {
      result = await action(null, form);
    } catch {
      result = { ok: false, error: "That didn't go through. Try again." };
    }
    if (result.ok) {
      router.push("/"); // stay busy while we leave
      return;
    }
    setBusy(false);
    setError(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" className="self-center text-destructive">
          Delete {name}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>This removes them from GiftsAF.</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirm()}>
            Delete
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
