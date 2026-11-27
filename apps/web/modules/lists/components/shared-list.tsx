"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { claimGift, unclaimGift, type UnclaimResult } from "@/modules/lists/actions/claims";
import { PageFrame } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import type { SharedSize } from "@/lib/size-kinds";
import { DEFAULT_LIST_TITLE } from "@/modules/lists/lib/list-title";
import type { GiftClaim, SharedGift, SharedList as SharedListData } from "@/modules/lists/lib/lists";
import AddToMineDialog, { addToMineExplained, rememberAddToMineExplained } from "./add-to-mine-dialog";
import ClaimDialog from "./claim-dialog";
import GiftList from "./gift-list";
import GiftSummary from "./gift-summary";
import { Banner } from "./ui";
import ViewDialog from "./view-dialog";

const ADD_LINK = "h-auto min-h-11 justify-start gap-1 px-0 text-[13px] font-normal text-muted-foreground underline underline-offset-2 hover:bg-transparent hover:text-foreground";

/**
 * `nav` fills the top bar (the page builds it; this is a client component), and
 * `top` is the card: above the heading when signed in, below the heading and
 * above the gifts when signed out, so a visitor sees the list first.
 */

export type SharedListProps = {
  list: SharedListData;
  token: string;
  nav?: ReactNode;
  top?: ReactNode;
  /** "+ My list": the share page's server action. Without it the button isn't shown. */
  addToMine?: (token: string, itemId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export default function SharedList({ list, token, nav, top, addToMine }: SharedListProps) {
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

  // The owner's shared sizes, fetched once after mount from their own address so the page, its
  // preview and get_shared_list never carry them. Any failure leaves null: no panel, no message.
  const [sizes, setSizes] = useState<SharedSize[] | null>(null);
  useEffect(() => {
    if (list.isOwner) return;
    const controller = new AbortController();
    fetch(`/share/${token}/sizes`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (Array.isArray(data)) setSizes(data as SharedSize[]);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [list.isOwner, token]);

  // "+ My list": gifts copied to the viewer's own list this visit, and the one being copied.
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedNotice, setAddedNotice] = useState(false);
  const canAdd = !!addToMine && !list.isOwner;

  // The first "Add to my list" explains itself (vs Claim); after that it just adds.
  const [explaining, setExplaining] = useState<SharedGift | null>(null);

  function signUpToAdd(gift: SharedGift) {
    return `/auth/sign-up?next=${encodeURIComponent(`/share/${token}?add=${gift.id}`)}`;
  }

  function startAddToMine(gift: SharedGift) {
    if (!addToMineExplained()) {
      setExplaining(gift);
      return;
    }
    if (list.viewer.signedIn) void handleAddToMine(gift);
    else router.push(signUpToAdd(gift));
  }

  function confirmAddToMine() {
    const gift = explaining;
    setExplaining(null);
    rememberAddToMineExplained();
    if (!gift) return;
    if (list.viewer.signedIn) void handleAddToMine(gift);
    else router.push(signUpToAdd(gift));
  }

  async function handleAddToMine(gift: SharedGift) {
    if (!addToMine) return;
    setAddingId(gift.id);
    setActionError("");
    let result: Awaited<ReturnType<typeof addToMine>>;
    try {
      result = await addToMine(token, gift.id);
    } catch {
      result = { ok: false, error: "Couldn't add that gift. Check your connection and try again." };
    }
    setAddingId(null);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setAdded((prev) => new Set(prev).add(gift.id));
    setAddedNotice(true);
    setAnnouncement(`Added ${gift.name} to your list.`);
  }

  // Back from signing in with ?add=<gift id>: add that gift once, then drop the
  // param so a reload doesn't add it again (a duplicate would be harmless anyway).
  const addedOnArrival = useRef(false);
  useEffect(() => {
    if (!canAdd || !list.viewer.signedIn || addedOnArrival.current) return;
    const id = new URLSearchParams(window.location.search).get("add");
    if (!id) return;
    addedOnArrival.current = true;
    rememberAddToMineExplained();
    router.replace(`/share/${token}${window.location.hash}`, { scroll: false });
    const gift = list.items.find((item) => item.id === id);
    if (gift) void handleAddToMine(gift);
    // Runs once on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Quieter than Claim on purpose: Claim is what this page is for, adding to your own list is a side door.
  function renderAddToMine(gift: SharedGift) {
    if (!canAdd) return null;
    if (added.has(gift.id)) {
      return (
        <span className="inline-flex min-h-11 items-center text-[13px] text-muted-foreground">On your list ✓</span>
      );
    }
    if (!list.viewer.signedIn) {
      // Sign up (which links to sign in) and come back here to add it.
      return (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={ADD_LINK}
          onClick={() => startAddToMine(gift)}
          aria-label={`Add ${gift.name} to my list`}
        >
          <Plus aria-hidden="true" />
          Add to my list
        </Button>
      );
    }
    const busy = addingId === gift.id;
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={ADD_LINK}
        onClick={() => startAddToMine(gift)}
        disabled={busy}
        aria-busy={busy}
        aria-label={`Add ${gift.name} to my list`}
      >
        <Plus aria-hidden="true" />
        {busy ? "Adding…" : "Add to my list"}
      </Button>
    );
  }

  function renderActions(gift: SharedGift) {
    // The owner never sees claims (product decision 39); the database sends
    // none, and there's nothing for them to claim. Nor the "+ My list" button.
    if (list.isOwner) return null;
    return (
      <>
        {renderClaim(gift)}
        {renderAddToMine(gift)}
      </>
    );
  }

  function renderClaim(gift: SharedGift) {
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
      <AddToMineDialog
        giftName={explaining?.name ?? null}
        ownerName={list.cardEnabled ? list.ownerName : null}
        signedOut={!list.viewer.signedIn}
        onConfirm={confirmAddToMine}
        onCancel={() => setExplaining(null)}
      />
      <TopBar>{nav}</TopBar>
      <PageFrame wide className="gap-4">
        {list.viewer.signedIn && top}
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
        {!list.viewer.signedIn && top}
        {addedNotice && (
          <Banner tone="accent">
            Added to your list.{" "}
            <Link href="/lists" className="underline underline-offset-[3px]">
              See your list
            </Link>
          </Banner>
        )}
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

      {viewing && <ViewDialog gift={viewing} sizes={sizes} ownerName={name} onClose={() => setViewing(null)} />}
      {claiming && (
        <ClaimDialog
          gift={claiming}
          viewer={list.viewer}
          sizes={sizes}
          ownerName={name}
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
