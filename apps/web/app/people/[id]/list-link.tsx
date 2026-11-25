"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SaveResult } from "@/modules/concierge";

type Action = (previous: null, formData: FormData) => Promise<SaveResult>;

/**
 * Paste a link to their GiftsAF list, or unlink it. The `prompt` variant is the
 * ask at the top of an unlinked person's page (ALL-123); the `page` variant is
 * the old Their list screen, shown only with the card switched off.
 */
export function ListLink({
  variant,
  name,
  personId,
  keepsList,
  hasAccess,
  linkAction,
  unlinkAction,
}: {
  variant: "prompt" | "page";
  name: string;
  personId: string;
  keepsList: boolean;
  /** To the concierge: without it no gift is waiting to ship. */
  hasAccess: boolean;
  /** `linkUnlinkedListAction` for the prompt (never replaces a link), `linkListAction` for the page */
  linkAction: Action;
  /** `unlinkListAction`; the prompt only shows while nothing is linked, so it has none */
  unlinkAction?: Action;
}) {
  const prompt = variant === "prompt";
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
        {prompt ? `Does ${name} have a GiftsAF list?` : "Link to their list"}
      </h2>
      {keepsList && unlinkAction ? (
        <>
          <p className="text-[13px] text-muted-foreground">Their list is linked.</p>
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
          <p className="text-[13px] text-muted-foreground">
            {prompt
              ? "Paste the link they sent you to link their list."
              : "You don't need their list to buy for them."}
          </p>
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
          {/* Decision 53: what spends money says so. It goes at the next tick, leaving time to unlink. */}
          {hasAccess && (
            <p className="text-[13px] text-muted-foreground">If a gift for them is waiting on an address, it will ship to this list&apos;s owner.</p>
          )}
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
