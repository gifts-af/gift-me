import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { withNext } from "@/lib/safe-next";
import type { ClaimResult } from "@/modules/lists/actions/claims";
import type { Gift, SharedList } from "@/modules/lists/lib/lists";
import Modal from "./modal";
import { Banner, inputClass, labelClass } from "./ui";

const NAME_KEY = "giftme:guest-name";
const MAX_NAME_LENGTH = 80;

// Storage can throw (private mode, blocked site data); a name is a nicety.
function readSavedName() {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string) {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // Not worth bothering anyone about.
  }
}

/**
 * Confirms a claim. `onConfirm(name)` resolves to the action's result; on
 * success the parent closes us, on failure we show its message. A claim that
 * lost the race says so here and offers only Cancel (mock-up "shared").
 */
export type ClaimDialogProps = {
  gift: Pick<Gift, "name">;
  viewer: SharedList["viewer"];
  // Where signing in comes back to.
  next: string;
  // `name` is undefined for a signed-in viewer: the database names them.
  onConfirm: (name: string | undefined) => Promise<ClaimResult>;
  onClose: () => void;
  // Set for a guest who hasn't waved it off: after a claim the box stays open
  // and offers their own list. The parent must then keep us mounted
  // on success. `ownerName` is the shown name, or null.
  offer?: { ownerName: string | null; onNotNow: () => void };
};

export default function ClaimDialog({ gift, viewer, next, onConfirm, onClose, offer }: ClaimDialogProps) {
  const [name, setName] = useState(() => (viewer.signedIn ? "" : readSavedName()));
  const [nameError, setNameError] = useState("");
  const [error, setError] = useState("");
  const [taken, setTaken] = useState(false);
  const [pending, setPending] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const offerHeading = useRef<HTMLHeadingElement>(null);

  // The form is gone; move focus to what replaced it so it's read out.
  useEffect(() => {
    if (claimed) offerHeading.current?.focus();
  }, [claimed]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmed = name.trim();
    if (!viewer.signedIn && !trimmed) {
      setNameError("Enter your name so others know who is buying this.");
      return;
    }
    setNameError("");
    setError("");
    setPending(true);

    let result: ClaimResult;
    try {
      result = await onConfirm(viewer.signedIn ? undefined : trimmed);
    } catch {
      result = { ok: false, error: "This gift couldn't be claimed. Check your connection and try again." };
    }
    // On success the parent unmounts us; only a failure needs local state.
    if (!result.ok) {
      setPending(false);
      if (result.alreadyClaimed) setTaken(true);
      else setError(result.error);
      return;
    }
    if (!viewer.signedIn) saveName(trimmed);
    if (offer) setClaimed(true);
  }

  if (claimed && offer) {
    return (
      <Modal labelledBy="claim-dialog-title" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <h2 id="claim-dialog-title" ref={offerHeading} tabIndex={-1} className="text-[17px] font-semibold outline-none [overflow-wrap:anywhere]">
            Claimed. {offer.ownerName ?? "They"} won&apos;t see it.
          </h2>
          <p className="text-[15px]">Want your own list for the family?</p>
          <Button asChild className="w-full">
            <Link href={withNext("/auth/sign-up", "/lists")}>Start yours, free</Link>
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-1 self-center"
            onClick={() => {
              offer.onNotNow();
              onClose();
            }}
          >
            Not now
          </Button>
          <p className="text-[13px] text-muted-foreground">Your claim stays a guest claim, so it can&apos;t be undone.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal labelledBy="claim-dialog-title" describedBy="claim-dialog-desc" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="claim-dialog-title" className="text-[17px] font-semibold">
            Claim this gift
          </h2>
          <p className="text-[15px] font-semibold [overflow-wrap:anywhere]">{gift.name}</p>
        </div>

        {taken ? (
          <Banner tone="warn" role="alert">
            Someone else just claimed this. Pick another gift.
          </Banner>
        ) : (
          <>
            <p id="claim-dialog-desc" className="text-[15px] text-muted-foreground">
              Only claim it if you’ll definitely buy it. Other friends will see it’s claimed; the list’s owner won’t.
            </p>

            {viewer.signedIn ? (
              <p className="text-[13px] text-muted-foreground">
                Claiming as <strong className="text-foreground">{viewer.name ?? "your account"}</strong>.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="claim-name" className={labelClass}>
                    Your name
                  </label>
                  <input
                    id="claim-name"
                    type="text"
                    autoComplete="name"
                    maxLength={MAX_NAME_LENGTH}
                    className={inputClass}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    aria-invalid={nameError ? "true" : undefined}
                    aria-describedby={nameError ? "claim-name-error" : undefined}
                    required
                    autoFocus
                  />
                  {nameError && (
                    <p className="text-[13px] text-destructive" id="claim-name-error">
                      {nameError}
                    </p>
                  )}
                </div>
                <p className="text-[13px] text-muted-foreground">
                  A guest claim can’t be undone.{" "}
                  <Link href={withNext("/auth/login", next)} className="text-foreground underline underline-offset-[3px]">
                    Sign in
                  </Link>{" "}
                  or{" "}
                  <Link href={withNext("/auth/sign-up", next)} className="text-foreground underline underline-offset-[3px]">
                    create an account
                  </Link>{" "}
                  to be able to unclaim it if plans change.
                </p>
              </>
            )}

            {error && (
              <p className="text-[13px] text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
              {pending ? "Claiming…" : "Claim gift"}
            </Button>
          </>
        )}
        <Button type="button" variant="link" size="sm" className="px-1 self-center" onClick={onClose}>
          Cancel
        </Button>
      </form>
    </Modal>
  );
}
