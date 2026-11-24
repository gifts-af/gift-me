"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { IDEA_RUN_OFF, ideaRunNotice } from "@gifts-af/core";
import { IdeaPhoto } from "@/components/idea-photo";
import { shortDate } from "@/lib/occasion-format";
import { storeLabel } from "@/lib/store-label";
import { Button } from "@/components/ui/button";
import type { IdeaRunOffer, ShownIdea } from "@/modules/concierge";
import { money } from "../money";
import { IDEA_MESSAGES, NO_FACTS } from "./messages";

// A person's Gift ideas screen (ALL-27): the Suggest button with its money notice beside it
// (design/ui.md > Money notice), then the ideas from the last run, each with Save (ALL-128),
// which copies it into the person's saved gifts so the next run doesn't lose it.

type Result = { ok: true; count: number } | { ok: false; error: string };
type SaveResult = { ok: true } | { ok: false; error: string };

/** Save on one idea, or "Saved" once that product is in the person's saved gifts. */
function SaveIdea({
  personId,
  idea,
  saved,
  saveAction,
}: {
  personId: string;
  idea: ShownIdea;
  saved: boolean;
  saveAction: (personId: string, ideaId: string) => Promise<SaveResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (saved || done) {
    return (
      <span className="flex flex-none items-center gap-1 text-[13px] font-semibold text-muted-foreground">
        <Check className="size-4" aria-hidden />
        Saved
      </span>
    );
  }

  function save() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      let result: SaveResult;
      try {
        result = await saveAction(personId, idea.id);
      } catch {
        // The same words as the server's TRY_AGAIN (modules/concierge/people/service.ts).
        result = { ok: false, error: "That couldn't be saved. Try again." };
      }
      if (result.ok) setDone(true);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-none flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={save} aria-label={`Save ${idea.title}`}>
        Save
      </Button>
      {error && (
        <p role="alert" className="max-w-48 text-right text-[13px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function IdeasScreen({
  personId,
  personName,
  offer,
  ideas,
  action,
  savedProductIds,
  saveAction,
}: {
  personId: string;
  personName: string;
  /** What a run costs, from settings, when the buyer can run one; otherwise why not. */
  offer: IdeaRunOffer;
  ideas: ShownIdea[];
  /** `suggestIdeasAction` */
  action: (personId: string) => Promise<Result>;
  /** Products already in the person's saved gifts. */
  savedProductIds: string[];
  /** `saveIdeaAction` */
  saveAction: (personId: string, ideaId: string) => Promise<SaveResult>;
}) {
  const saved = new Set(savedProductIds);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function suggest() {
    setError(null);
    startTransition(async () => {
      let result: Result;
      try {
        result = await action(personId);
      } catch {
        result = { ok: false, error: "Couldn't get ideas. Try again." };
      }
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      {offer.kind === "ready" ? (
        <div className="flex flex-col gap-2">
          <Button type="button" className="self-start" disabled={pending} onClick={suggest}>
            {`Suggest ideas for ${personName}`}
          </Button>
          <p role="note" className="rounded-md bg-warning-soft px-2.5 py-1.5 text-[13px] text-warning">
            {ideaRunNotice(offer.estimateCents, offer.maxCents)}
          </p>
          {pending && (
            <p role="status" className="text-[13px] text-muted-foreground">
              Looking. This takes about a minute.
            </p>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">{offer.kind === "off" ? IDEA_MESSAGES.off : IDEA_RUN_OFF}</p>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
          {error === NO_FACTS && (
            <>
              {" "}
              <Link href={`/people/${personId}/questions`} className="font-semibold underline">
                Answer a few questions
              </Link>
            </>
          )}
        </p>
      )}

      {ideas.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border" aria-label="Gift ideas">
          {ideas.map((idea) => {
            const store = storeLabel(idea.retailer);
            return (
              <li key={idea.id} className="flex items-start gap-3 px-4 py-3" data-retailer-product-id={idea.retailerProductId ?? undefined}>
                <IdeaPhoto url={idea.imageUrl} title={idea.title} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-3">
                  {idea.productUrl ? (
                    <a href={idea.productUrl} target="_blank" rel="noreferrer" className="text-[15px] font-semibold [overflow-wrap:anywhere]">
                      {idea.title}
                    </a>
                  ) : (
                    <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{idea.title}</span>
                  )}
                  {idea.retailerProductId && (
                    <SaveIdea personId={personId} idea={idea} saved={saved.has(idea.retailerProductId)} saveAction={saveAction} />
                  )}
                </div>
                {idea.overBudget && (
                  <span className="self-start rounded-md bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">Over budget</span>
                )}
                <p className="text-[13px] text-muted-foreground">
                  {store ? `${money(idea.priceCents)} · ${store}` : money(idea.priceCents)}
                </p>
                <p className="text-[13px] text-muted-foreground">{`About ${money(idea.totalCents)} with shipping, tax and fee`}</p>
                {idea.arriveBy && (
                  <p className="text-[13px] text-muted-foreground">Arrives by {shortDate(idea.arriveBy)} if ordered today</p>
                )}
                {idea.reason && <p className="text-[15px]">{idea.reason}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[15px] text-muted-foreground">No ideas yet.</p>
      )}
    </>
  );
}
