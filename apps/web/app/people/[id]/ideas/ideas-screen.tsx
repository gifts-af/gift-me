"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { IDEA_RUN_OFF, ideaRunNotice } from "@gifts-af/core";
import { shortDate } from "@/components/occasion-format";
import { Button } from "@/components/ui/button";
import type { IdeaRunOffer, ShownIdea } from "@/modules/concierge";
import { money } from "../money";
import { IDEA_MESSAGES, NO_FACTS } from "./messages";

// A person's Gift ideas screen (ALL-27): the Suggest button with its money notice beside it
// (design/ui.md > Money notice), then the ideas from the last run. Each idea keeps its product
// id on the page, so Save (ALL-128) can be added without another read.

type Result = { ok: true; count: number } | { ok: false; error: string };

/** "Amazon" from the stored "amazon". */
function storeLabel(retailer: string | null): string | null {
  return retailer ? retailer.charAt(0).toUpperCase() + retailer.slice(1) : null;
}

export function IdeasScreen({
  personId,
  personName,
  offer,
  ideas,
  action,
}: {
  personId: string;
  personName: string;
  /** What a run costs, from settings, when the buyer can run one; otherwise why not. */
  offer: IdeaRunOffer;
  ideas: ShownIdea[];
  /** `suggestIdeasAction` */
  action: (personId: string) => Promise<Result>;
}) {
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
              <li key={idea.id} className="flex flex-col gap-1 px-4 py-3" data-retailer-product-id={idea.retailerProductId ?? undefined}>
                <div className="flex items-start justify-between gap-3">
                  {idea.productUrl ? (
                    <a href={idea.productUrl} target="_blank" rel="noreferrer" className="text-[15px] font-semibold [overflow-wrap:anywhere]">
                      {idea.title}
                    </a>
                  ) : (
                    <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{idea.title}</span>
                  )}
                  {idea.overBudget && (
                    <span className="flex-none rounded-md bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">Over budget</span>
                  )}
                </div>
                <p className="text-[13px] text-muted-foreground">
                  {store ? `${money(idea.totalCents)} · ${store}` : money(idea.totalCents)}
                </p>
                {idea.arriveBy && (
                  <p className="text-[13px] text-muted-foreground">Arrives by {shortDate(idea.arriveBy)} if ordered today</p>
                )}
                {idea.reason && <p className="text-[15px]">{idea.reason}</p>}
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
