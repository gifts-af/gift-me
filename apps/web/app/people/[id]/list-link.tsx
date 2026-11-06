"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SaveResult } from "@/modules/concierge";

type Action = (previous: null, formData: FormData) => Promise<SaveResult>;

/** Paste a link to their GiftsAF list, or unlink it. */
export function ListLink({
  personId,
  keepsList,
  linkAction,
  unlinkAction,
}: {
  personId: string;
  keepsList: boolean;
  /** `linkListAction` */
  linkAction: Action;
  /** `unlinkListAction` */
  unlinkAction: Action;
}) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: Action, extra?: [string, string]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("id", personId);
    if (extra) form.set(extra[0], extra[1]);
    let result: SaveResult;
    try {
      result = await action(null, form);
    } catch {
      result = { ok: false, error: "That didn't save. Try again." };
    }
    setBusy(false);
    if (result.ok) setLink("");
    else setError(result.error);
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby="link-heading">
      <h2 id="link-heading" className="text-lg font-semibold">
        Link to their list
      </h2>
      {keepsList ? (
        <>
          <p className="text-[13px] text-muted-foreground">Linked. Their ideas come from their own list.</p>
          <Button type="button" variant="outline" className="self-start" disabled={busy} onClick={() => void run(unlinkAction)}>
            Unlink
          </Button>
        </>
      ) : (
        <form
          className="flex flex-col gap-1.5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            // From the field itself: a paste before hydration never reached state.
            const value = String(new FormData(e.currentTarget).get("link") ?? "");
            setLink(value);
            void run(linkAction, ["link", value]);
          }}
        >
          <Label htmlFor="list-link">Their list link</Label>
          <div className="flex items-center gap-2">
            <Input
              id="list-link"
              name="link"
              placeholder="Paste the link they shared"
              autoComplete="off"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              Link
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
