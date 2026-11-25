"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { claimGift, unclaimGift, type UnclaimResult } from "@/modules/lists/actions/claims";
import { PageFrame } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { DEFAULT_LIST_TITLE } from "@/modules/lists/lib/list-title";
import type { GiftClaim, SharedGift, SharedList as SharedListData } from "@/modules/lists/lib/lists";
import ClaimDialog from "./claim-dialog";
import GiftList from "./gift-list";
import GiftSummary from "./gift-summary";
import { Banner } from "./ui";
import ViewDialog from "./view-dialog";

/**
 * `nav` fills the top bar (the page builds it; this is a client component), and
 * `top` renders above the heading.
 */
export type SharedListProps = {
  list: SharedListData;
  token: string;
  nav?: ReactNode;
  top?: ReactNode;
};

export default function SharedList({ list, token, nav, top }: SharedListProps) {
  const router = useRouter();
  // Claims change here without a reload. A refresh hands down a new
  // list.items, which replaces the local copy (React's "adjust state when a
  // prop changes" pattern, rather than an effect that renders twice).
  const [items, setItems] = useState(list.items);
  const [sourceItems, setSourceItems] = useState(list.items);
  if (sourceItems !== list.items) {
    setSourceItems(list.items);
    setItems(list.items);
  }

  const [claiming, setClaiming] = useState<SharedGift | null>(null);
  const [viewing, setViewing] = useState<SharedGift | null>(null);
  const [unclaimingId, setUnclaimingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  // "Not now" on the own-list offer holds for the rest of this visit.
  const [offerWavedOff, setOfferWavedOff] = useState(false);
  const offerOwnList = !list.viewer.signedIn && !list.isOwner && !offerWavedOff;

  // A link to one gift. The list streams in after the page does, too late for the browser's own
  // jump to it.
  useEffect(() => {
    if (window.location.hash.startsWith("#gift-")) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "center" });
    }
  }, []);

  // The owner sees their own title; everyone else sees whose list it is, with
  // a custom title as a smaller line (ALL-123). With the switch off it names
  // nobody, not even your own linked person (AC-25).
  const name = list.cardEnabled ? (list.linkedPerson?.name ?? list.ownerName) : null;
  const heading = list.isOwner ? list.title : name ? `${name}'s list` : "Their list";
  const showTitle = !list.isOwner && list.title !== DEFAULT_LIST_TITLE;

  function setClaim(itemId: string, claim: GiftClaim | null) {
    setItems((prev) => prev.map((gift) => (gift.id === itemId ? { ...gift, claim } : gift)));
  }

  async function handleClaim(gift: SharedGift, name: string | undefined) {
    const result = await claimGift({ token, itemId: gift.id, name });
    if (result.ok) {
      setClaim(gift.id, result.claim);
      // A guest is offered their own list first; the dialog closes itself.
      if (!offerOwnList) setClaiming(null);
      setActionError("");
      setAnnouncement(`You claimed ${gift.name}.`);
    } else if (result.alreadyClaimed) {
      // The dialog says so; the refresh shows who got there first.
      router.refresh();
    }
    return result;
  }

  async function handleUnclaim(gift: SharedGift) {
    setUnclaimingId(gift.id);
    setActionError("");
    let result: UnclaimResult;
    try {
      result = await unclaimGift({ token, itemId: gift.id });
    } catch {
      result = { ok: false, error: "This gift couldn't be unclaimed. Check your connection and try again." };
    }
    setUnclaimingId(null);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setClaim(gift.id, null);
    setAnnouncement(`You unclaimed ${gift.name}.`);
  }

  function renderActions(gift: SharedGift) {
    // The owner never sees claims (product decision 39); the database sends
    // none, and there's nothing for them to claim.
    if (list.isOwner) return null;

    if (gift.claim) {
      return (
        <>
          <span className="text-[13px] text-muted-foreground">Claimed by {gift.claim.mine ? "you" : gift.claim.name}</span>
          {gift.claim.mine && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleUnclaim(gift)}
              disabled={unclaimingId === gift.id}
              aria-busy={unclaimingId === gift.id}
              aria-label={`Unclaim ${gift.name}`}
            >
              {unclaimingId === gift.id ? "Unclaiming…" : "Unclaim"}
            </Button>
          )}
        </>
      );
    }

    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full"
        onClick={() => {
          setActionError("");
          setClaiming(gift);
        }}
        aria-label={`Claim ${gift.name}`}
      >
        Claim
      </Button>
    );
  }

  return (
    <>
      <TopBar>{nav}</TopBar>
      <PageFrame wide className="gap-4">
        {top}
        {list.isOwner && (
          <Banner tone="accent">This is your list. Claims are hidden from you, so your gifts stay a surprise.</Banner>
        )}
        <div className="flex flex-col gap-1">
          <h1 id="list-heading" className="text-[22px] font-bold leading-tight [overflow-wrap:anywhere]">
            {heading}
          </h1>
          {showTitle && <p className="text-[15px] text-muted-foreground [overflow-wrap:anywhere]">{list.title}</p>}
          <GiftSummary gifts={items} />
          {!list.isOwner && (
            <p className="text-[13px] text-muted-foreground">
              Planning to buy something? Claim it so nobody else buys the same gift.
            </p>
          )}
        </div>
        {actionError && (
          <Banner tone="error" role="alert">
            {actionError}
          </Banner>
        )}
        {/* No onRemove: shared lists are read-only. Only unclaimed gifts ask
            "are you going to buy?"; the owner can't claim, so isn't asked. */}
        <section aria-labelledby="list-heading">
          <GiftList
            gifts={items}
            emptyMessage="This list is empty."
            renderActions={renderActions}
            onView={
              list.isOwner
                ? undefined
                : (gift) => {
                    const current = items.find((item) => item.id === gift.id);
                    if (current?.claim) {
                      window.open(gift.productUrl ?? undefined, "_blank", "noopener,noreferrer");
                    } else {
                      setViewing(gift);
                    }
                  }
            }
          />
        </section>
        {/* Guests arrive here on a task; a quiet way to find out more (ALL-46). */}
        <div className="flex flex-wrap justify-center gap-x-5">
          {[
            ["/", "What is GiftsAF?"],
            ["/privacy", "Privacy"],
            ["/feedback", "Feedback"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="inline-flex min-h-11 items-center text-[13px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </div>
      </PageFrame>

      {viewing && <ViewDialog gift={viewing} onClose={() => setViewing(null)} />}
      {claiming && (
        <ClaimDialog
          gift={claiming}
          viewer={list.viewer}
          next={`/share/${token}`}
          onConfirm={(name) => handleClaim(claiming, name)}
          onClose={() => setClaiming(null)}
          offer={offerOwnList ? { ownerName: name, onNotNow: () => setOfferWavedOff(true) } : undefined}
        />
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
