"use client";

import { Button } from "@/components/ui/button";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { onBeforeLeaving } from "@/lib/leaving-page";
import { saveList } from "@/modules/lists/actions/lists";
import { lookUpAmazon } from "@/modules/lists/actions/amazon-lookup";
import { readStorePage } from "@/modules/lists/actions/store-page";
import {
  createListSaver,
  type CloseBody,
  type CloseResult,
  type ListSaver,
  type SaveStatus,
} from "@/modules/lists/lib/list-saver";
import type { Gift, MyList } from "@/modules/lists/lib/lists";
import { sizeKindsFor } from "@/modules/lists/lib/relevant-sizes";
import type { SizeKind } from "@/lib/size-kinds";
import AddGiftPanel, { type NewGift } from "./add-gift-panel";
import GiftList from "./gift-list";
import GiftSummary from "./gift-summary";
import Link from "next/link";
import { PageFrame } from "@/components/app-shell/page-frame";
import NamePrompt, { skippedNamePrompt } from "./name-prompt";
import ShareButton from "./share-button";
import ShareMenu from "./share-menu";
import SizeAsk, { dismissedSizes, sizeName, type SaveSize } from "./size-ask";
import { Banner, inputClass } from "./ui";

export { UNDO_MS } from "@/modules/lists/lib/list-saver";

// What the guest list looks like in localStorage.
type GuestStash = { items?: Gift[]; at: number };

// A guest's list is carried across the trip to /auth/* in localStorage, so
// signing in (or confirming a sign-up email in a new tab) doesn't lose it.
const GUEST_STASH_KEY = "giftme:guest-list";
const GUEST_STASH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Where a closing tab sends a remove still held for Undo (ALL-127).
const CLOSE_ROUTE = "/api/lists/save-on-close";

// crypto.randomUUID is undefined outside a secure context -- which includes
// demoing over plain HTTP on a phone via `next dev -H 0.0.0.0`.
function newId(): string {
  return crypto.randomUUID?.() ?? `g_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// `keep` leaves the stash in place, for when the list it would join can't be
// saved yet -- a later, successful load picks it up again.
function takeGuestStash({ keep = false }: { keep?: boolean } = {}): Gift[] {
  try {
    const raw = localStorage.getItem(GUEST_STASH_KEY);
    if (!raw) return [];
    if (!keep) localStorage.removeItem(GUEST_STASH_KEY);
    const stash: GuestStash | null = JSON.parse(raw);
    if (!Array.isArray(stash?.items) || Date.now() - stash.at > GUEST_STASH_MAX_AGE_MS) return [];
    return stash.items.map((gift) => ({ ...gift, id: newId() }));
  } catch {
    return []; // storage blocked, or a corrupt entry
  }
}

function putGuestStash(items: Gift[]) {
  try {
    localStorage.setItem(GUEST_STASH_KEY, JSON.stringify({ items, at: Date.now() }));
  } catch {
    // Storage blocked: the list is lost on the way to sign in, as without this.
  }
}

// A keepalive fetch outlives the page; a server action started now wouldn't.
// Only ids go: keepalive bodies are capped at 64 KiB. Resolves to the route's
// { version, behind } when saved, for a tab that lives on, or null.
function sendOnClose(body: CloseBody): Promise<CloseResult> {
  return fetch(CLOSE_ROUTE, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}

// Once this page is hidden by the router (Next keeps a page left in the app
// mounted under <Activity mode="hidden">) its effects have cleaned up, but the
// save started on the way out may still be running. Until it's done and
// saved: Sign out waits for it, closing the tab warns, and a closing tab
// sends any remove it couldn't. Returns the stop.
function guardWhileSaving(saver: ListSaver, sending: Promise<unknown>): () => void {
  const stopWaiting = onBeforeLeaving(() => sending);
  function warn(event: BeforeUnloadEvent) {
    if (saver.getSnapshot().status === "idle") return;
    event.preventDefault();
    event.returnValue = "";
  }
  function onPageHide() {
    saver.closing();
  }
  window.addEventListener("beforeunload", warn);
  window.addEventListener("pagehide", onPageHide);
  let unsubscribe = () => {};
  let stopped = false;
  function stop() {
    stopped = true;
    stopWaiting();
    unsubscribe();
    window.removeEventListener("beforeunload", warn);
    window.removeEventListener("pagehide", onPageHide);
  }
  // A failed save keeps the guard up; it goes once a later save succeeds.
  sending.then(() => {
    stopWaiting();
    if (stopped) return;
    if (saver.getSnapshot().status === "idle") stop();
    else
      unsubscribe = saver.subscribe(() => {
        if (saver.getSnapshot().status === "idle") stop();
      });
  });
  return stop;
}

// The same while loading and loaded, so Share arriving doesn't move the page.
// Instagram offers Story and Feed only for an image file, and only phones run it.
function canShareImageFile(): boolean {
  if (typeof navigator.canShare !== "function" || window.matchMedia?.("(pointer: coarse)").matches !== true) return false;
  try {
    return navigator.canShare({ files: [new File([], "x.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

const INSTAGRAM_NOTE = "Link copied. In Instagram, add a Link sticker and paste it.";

const TITLE_ROW ="flex min-h-11 items-center justify-between gap-3";

export function GiftAppSkeleton() {
  return (
    <PageFrame wide>
      <div className={TITLE_ROW}>
        <h1 className="text-[22px] font-bold leading-tight">My list</h1>
      </div>
      <p className="text-[15px] text-muted-foreground" aria-busy="true">
        Loading your list…
      </p>
    </PageFrame>
  );
}

const STATUS_TEXT: Record<SaveStatus, string> = { idle: "Saved", saving: "Saving…", error: "Couldn't save" };

type SaveName = (name: string) => Promise<{ ok: true } | { ok: false; error: string }>;

type GiftAppProps = {
  initial: MyList | null;
  footer?: ReactNode;
  shareHint?: ReactNode;
  needsName?: boolean;
  saveName?: SaveName | null;
  sizeAsk?: { missing: SizeKind[]; save: SaveSize; userId: string } | null;
};

/**
 * `initial` is null for a guest. `footer` shows below the list once a saved list exists.
 * `shareHint` shows beside the save status once Share has been used.
 * `needsName` (no display name yet) makes Share ask for one, saved with `saveName` (ALL-136).
 * `sizeAsk` (signed in, sizes sharing on) asks for a missing size when a gift
 * that needs one is added: `missing` is every size not saved yet.
 * The list is built from `initial` once: a later render with new data (a
 * router refresh) doesn't replace what's on screen.
 */
export default function GiftApp({
  initial,
  footer = null,
  shareHint = null,
  needsName = false,
  saveName = null,
  sizeAsk = null,
}: GiftAppProps) {
  const isGuest = initial === null;
  const loadError = initial?.loadError ?? null;
  // Fixed at the first render, so a refresh that fails to load can't stop a
  // save that's on its way.
  const [canSave] = useState(() => initial !== null && !initial.loadError);
  const [saver] = useState(() => createListSaver({ initial, enabled: canSave, save: saveList, sendOnClose }));
  const list = useSyncExternalStore(saver.subscribe, saver.getSnapshot, saver.getSnapshot);
  const gifts = list.gifts;

  // Kept apart from `notice` so copying a link never hides the carried-gifts
  // message. `url` is set when the clipboard can't be written, to copy by hand.
  const [shareNotice, setShareNotice] = useState<{ text: string; url?: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  // The guest stash is taken once per list on screen: a page hidden by the
  // router and shown again keeps its state, so taking it again would double it.
  const stashTaken = useRef(false);
  const stopHiddenGuard = useRef<(() => void) | null>(null);
  const heldId = list.held?.gift.id ?? null;

  const shareBlockedReason = isGuest ? "Sign in to share your list" : !list.shareToken ? "Save your list to share it" : null;
  // Guests lose everything on leaving. Members are warned only while a save
  // is on its way or has failed: a held remove is sent as the tab goes.
  const atRisk = isGuest ? gifts.length > 0 : canSave ? list.status !== "idle" : list.dirty;
  const askBeforeLeaving = !isGuest && (canSave ? list.status === "error" : list.dirty);

  // Pick up a list brought over from before signing in (or from a guest's
  // own trip to the sign-in page and back). Read in an effect, not during
  // render, so the server-rendered HTML still matches on hydration. A
  // member's carried gifts save straight away.
  useEffect(() => {
    if (stashTaken.current) return;
    stashTaken.current = true;
    const carried = takeGuestStash({ keep: loadError !== null });
    if (carried.length === 0) return;
    saver.add(...carried);
    if (!isGuest && !loadError) {
      setNotice(`We brought over ${carried.length === 1 ? "1 gift" : `${carried.length} gifts`} from before you signed in.`);
    }
  }, [isGuest, loadError, saver]);

  // Client-side navigation to /auth/* unmounts the app; stash the guest's
  // list on the way out. Closing the tab runs no cleanup, so that still loses
  // it -- guests are only ever warned, never saved.
  useEffect(() => {
    if (!isGuest) return;
    return () => {
      const { gifts: left } = saver.getSnapshot();
      if (left.length > 0) putGuestStash(left);
    };
  }, [isGuest, saver]);

  // A remove held for Undo is sent before the page goes. When the tab is
  // hidden or closes, it goes to the close route with keepalive (phones often
  // never fire pagehide, and may stop a hidden tab's requests). When this page
  // is left in the app (Next keeps it mounted but hidden, which runs this
  // cleanup) or Sign out is picked, it's a normal save, and guardWhileSaving
  // covers the time until that's done.
  useEffect(() => {
    if (!canSave) return;
    stopHiddenGuard.current?.(); // shown again: these listeners take over
    stopHiddenGuard.current = null;
    function onVisibility() {
      if (document.visibilityState === "hidden") saver.closing();
    }
    function onPageHide() {
      saver.closing();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    const stopWaiting = onBeforeLeaving(() => saver.flush());
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      stopWaiting();
      stopHiddenGuard.current = guardWhileSaving(saver, saver.flush());
    };
  }, [canSave, saver]);

  // Undo gets focus as its bar appears, so a keyboard or screen-reader user
  // can reach it straight away; the window waits while it has focus.
  useEffect(() => {
    if (heldId) undoRef.current?.focus();
  }, [heldId]);

  useEffect(() => {
    if (!atRisk) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = ""; // still required by some browsers
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [atRisk]);

  // In-app links (Get, Give, the logo) navigate without beforeunload, so ask
  // here, but only once a save has failed: one on its way finishes with the
  // page hidden. Capture on document runs before React's own listeners, so
  // stopping the click keeps <Link> from navigating. Guests are stashed on
  // unmount. `data-leaves-page` marks anything else that leaves: Sign out in
  // AccountMenu.
  useEffect(() => {
    if (!askBeforeLeaving) return;
    function confirmLeave(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const leaving = event.target instanceof Element ? event.target.closest("a[href], [data-leaves-page]") : null;
      if (!leaving) return;
      if (leaving.matches("a[href]")) {
        const link = leaving as HTMLAnchorElement;
        if (link.target === "_blank" || link.origin !== window.location.origin) return;
        if (link.pathname === window.location.pathname) return;
      }
      if (window.confirm("You have unsaved changes. Leave without saving?")) return;
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("click", confirmLeave, true);
    return () => document.removeEventListener("click", confirmLeave, true);
  }, [askBeforeLeaving]);

  // The size the card is asking for, and the sizes still missing: one saved
  // here isn't asked for again, without waiting for a reload.
  const [askingSize, setAskingSize] = useState<{ kind: SizeKind; key: number } | null>(null);
  const [missingSizes, setMissingSizes] = useState(() => new Set(sizeAsk?.missing ?? []));
  // Next keeps this page's state when it's left: an old card shouldn't greet you on return.
  useLayoutEffect(() => () => setAskingSize(null), []);

  function addGift(draft: NewGift) {
    setNotice("");
    saver.add({ ...draft, id: newId(), addedAt: Date.now() });
    if (!sizeAsk) return;
    const dismissed = dismissedSizes(sizeAsk.userId);
    const kind = sizeKindsFor(draft.name).find((k) => k !== "color" && missingSizes.has(k) && !dismissed.has(k));
    // A gift with nothing to ask leaves an open card alone, so a half-typed size isn't lost.
    if (kind) setAskingSize((now) => (now?.kind === kind ? now : { kind, key: Date.now() }));
    // The add panel announces the add; this says what appeared below it.
    if (kind) setAnnouncement(`Add your ${sizeName(kind)}? Asked below, optional.`);
  }

  function setMissing(kind: SizeKind, missing: boolean) {
    setMissingSizes((now) => {
      const next = new Set(now);
      if (missing) next.add(kind);
      else next.delete(kind);
      return next;
    });
  }

  function removeGift(id: string) {
    const name = gifts.find((g) => g.id === id)?.name;
    saver.remove(id);
    // Removing the focused button would otherwise drop focus onto <body> and
    // strand keyboard users at the top of the document. A member's focus then
    // moves on to Undo, once its bar is on screen.
    headingRef.current?.focus();
    if (canSave && name) setAnnouncement(`Removed ${name}. Undo available.`);
  }

  function undoRemove() {
    saver.undo();
    headingRef.current?.focus();
    setAnnouncement("");
  }

  // ALL-136: someone with no display name is asked for one on Share, until
  // they give one or skip it on this device.
  const [named, setNamed] = useState(!needsName);
  const [askingName, setAskingName] = useState(false);
  const [shared, setShared] = useState(false);
  // Next keeps this page's state when it's left: the note waits for the next Share.
  useLayoutEffect(() => () => setShared(false), []);
  // Bumped when the link is copied, so Share shows "Copied!".
  const [copiedSignal, setCopiedSignal] = useState(0);

  const [menuOpen, setMenuOpen] = useState(false);
  // What this device can do, read after hydration so the server and first render agree.
  const [device, setDevice] = useState({ touch: false, sheet: false, imageFiles: false });
  useEffect(
    () =>
      setDevice({
        touch: window.matchMedia?.("(pointer: coarse)").matches === true,
        sheet: typeof navigator.share === "function",
        imageFiles: canShareImageFile(),
      }),
    [],
  );
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const shareUrl = list.shareToken && origin ? `${origin}/share/${list.shareToken}` : "";

  async function handleShareClick(): Promise<boolean> {
    if (!named && saveName && !skippedNamePrompt()) {
      setAskingName(true);
      return false;
    }
    setMenuOpen(true);
    return false;
  }

  // Resolves true only once the link is on the clipboard; otherwise shows it to copy by hand.
  async function copyShareLink(): Promise<boolean> {
    if (!list.shareToken) return false;
    const url = `${window.location.origin}/share/${list.shareToken}`;
    setAnnouncement("");
    setShared(true);
    try {
      // Undefined outside a secure context, e.g. a phone on plain HTTP.
      await navigator.clipboard.writeText(url);
    } catch {
      setShareNotice({ text: "Copy this link to share your list.", url });
      return false;
    }
    setShareNotice(null);
    setAnnouncement("Share link copied.");
    return true;
  }

  function copyAndSay() {
    void copyShareLink().then((ok) => ok && setCopiedSignal((n) => n + 1));
  }

  // The browser's own share sheet; if it fails, copies the link. Called before any
  // await, so the tap still counts.
  async function openShareSheet() {
    if (!list.shareToken) return;
    const url = `${window.location.origin}/share/${list.shareToken}`;
    setAnnouncement("");
    setShared(true);
    try {
      await navigator.share({ title: "My gift list", text: "My gift list on GiftsAF", url });
      setShareNotice(null);
    } catch (e) {
      // Closing the sheet isn't a failure; anything else falls back to copying.
      if (e instanceof DOMException && e.name === "AbortError") return;
      copyAndSay();
    }
  }

  // Instagram Story: the list card as a PNG, fetched ahead so the tap can open the
  // sheet at once (Safari drops the tap after a long await).
  const storyImage = useRef<Blob | null>(null);
  const shareToken = list.shareToken;
  const instagramShown = device.imageFiles && !isGuest && !!shareToken && shareBlockedReason === null;
  useEffect(() => {
    storyImage.current = null;
    if (!instagramShown || !shareToken) return;
    let current = true;
    fetch(`/share/${shareToken}/story`)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (current && blob) storyImage.current = blob;
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [instagramShown, shareToken]);

  async function shareToInstagram() {
    const blob = storyImage.current;
    if (!blob || !list.shareToken) {
      await openShareSheet();
      return;
    }
    const url = `${window.location.origin}/share/${list.shareToken}`;
    // Not awaited: the share below has to start inside the tap.
    navigator.clipboard?.writeText(url).catch(() => {});
    const sharing = navigator.share({ files: [new File([blob], "giftsaf-list.png", { type: "image/png" })] });
    setShared(true);
    setShareNotice({ text: INSTAGRAM_NOTE });
    setAnnouncement(INSTAGRAM_NOTE);
    try {
      await sharing;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setShareNotice(null);
      setAnnouncement("");
      await openShareSheet();
    }
  }

  // "Saving…" and a failed save need the row for themselves.
  const hintShown = shared && shareHint !== null && list.status === "idle";

  return (
    <>
      <PageFrame wide className="gap-4">
        {saveName && (
          <NamePrompt
            open={askingName}
            onOpenChange={setAskingName}
            saveName={saveName}
            copyLink={copyShareLink}
            onCopied={() => setCopiedSignal((n) => n + 1)}
            onNamed={() => setNamed(true)}
          />
        )}
        {shareUrl && (
          <ShareMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            url={shareUrl}
            instagram={instagramShown}
            messages={device.touch}
            more={device.sheet}
            onInstagram={() => void shareToInstagram()}
            onCopy={copyAndSay}
            onMore={() => void openShareSheet()}
            onUsed={() => setShared(true)}
          />
        )}
        {isGuest && (
          <Banner>
            You’re not signed in.{" "}
            <Link href="/auth/login?next=%2Flists" className="underline underline-offset-[3px]">
              Sign in
            </Link>{" "}
            or{" "}
            <Link href="/auth/sign-up?next=%2Flists" className="underline underline-offset-[3px]">
              create an account
            </Link>{" "}
            to save and share your list.
          </Banner>
        )}
        {loadError && (
          <Banner tone="error" role="alert">
            {loadError}
          </Banner>
        )}
        {notice && (
          <Banner tone="accent" role="status">
            {notice}
          </Banner>
        )}
        {list.notice && (
          <Banner tone="accent" role="status">
            {list.notice}
          </Banner>
        )}
        {list.status === "error" && list.error && (
          <Banner tone="error" role="alert">
            {list.error}
          </Banner>
        )}

        <div className="flex flex-col gap-1">
          <div className={TITLE_ROW}>
            <h1 id="list-heading" ref={headingRef} tabIndex={-1} className="text-[22px] font-bold leading-tight">
              My list
            </h1>
            {!isGuest && (
              <ShareButton blockedReason={shareBlockedReason} onShare={handleShareClick} copiedSignal={copiedSignal} />
            )}
          </div>
          <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3">
            <GiftSummary gifts={gifts} />
            {canSave && (
              <div className="flex items-center gap-1">
                {hintShown && shareHint}
                <p
                  role="status"
                  aria-label="Save status"
                  // No room for both beside a phone's summary.
                  className={`text-[13px] ${hintShown ? "ml-2 max-sm:sr-only" : ""} ${list.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {list.status === "idle" && !list.listId ? "" : STATUS_TEXT[list.status]}
                </p>
                {list.status === "error" && (
                  <Button type="button" variant="link" size="sm" className="px-1 text-[13px]" onClick={saver.retry}>
                    Try again
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {shareNotice && (
          <Banner tone="accent" className="flex flex-col gap-2">
            <p role="status">{shareNotice.text}</p>
            {shareNotice.url && (
              <>
                <label htmlFor="share-url" className="sr-only">
                  Share link
                </label>
                <input
                  id="share-url"
                  type="text"
                  readOnly
                  value={shareNotice.url}
                  autoFocus
                  className={`${inputClass} num text-foreground`}
                  onFocus={(event) => event.target.select()}
                />
              </>
            )}
          </Banner>
        )}

        {/* Only signed-in people can have our server read a store page (ALL-10) or look up an Amazon product (ALL-141). */}
        <AddGiftPanel
          onAdd={addGift}
          readStorePage={isGuest ? undefined : readStorePage}
          lookUpAmazon={isGuest ? undefined : lookUpAmazon}
        />

        {sizeAsk && askingSize && !isGuest && (
          <SizeAsk
            key={askingSize.key}
            kind={askingSize.kind}
            userId={sizeAsk.userId}
            save={sizeAsk.save}
            onSaving={(kind) => setMissing(kind, false)}
            onFailed={(kind) => setMissing(kind, true)}
            onClose={() => {
              setAskingSize(null);
              // The card had focus; don't leave it on <body>.
              headingRef.current?.focus();
            }}
          />
        )}

        <section aria-labelledby="list-heading" className="pt-2">
          <GiftList gifts={gifts} onRemove={removeGift} />
        </section>

        {list.listId && !loadError && footer}
      </PageFrame>

      {/* Undo stays in view at the bottom, in thumb reach on a phone, lined
          up with the list's column (design/ui.md > My list). Its 6 s wait
          while it has focus or the pointer. */}
      {list.held && (
        <div className="sticky bottom-0 border-t bg-background pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
          <div
            className="mx-auto flex max-w-5xl items-center gap-2 px-4 sm:px-8"
            onMouseEnter={() => saver.pauseUndo("hover")}
            onMouseLeave={() => saver.resumeUndo("hover")}
            onFocus={() => saver.pauseUndo("focus")}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) saver.resumeUndo("focus");
            }}
          >
            <p className="min-w-0 truncate text-[15px]">Removed {list.held.gift.name}</p>
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            <Button ref={undoRef} type="button" variant="secondary" size="sm" onClick={undoRemove}>
              Undo
            </Button>
          </div>
        </div>
      )}
      {isGuest && (
        <div className="sticky bottom-0 border-t bg-background px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 text-center text-[13px] text-muted-foreground sm:static">
          Guest lists are lost when you leave. Sign in to keep it.
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
