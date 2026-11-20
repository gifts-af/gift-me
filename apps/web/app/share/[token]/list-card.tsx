"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

type Result = { ok: true } | { ok: false; error: string };
type Action = (token: string, personId: string) => Promise<Result>;

const TRY_AGAIN = "That didn't save. Try again.";
const PICKER_LABEL = "Already in your people? Link to…";

/** A server action that fails outright (offline, a crash) reads as a plain error (Review 2). */
async function attempt(action: Action, token: string, personId: string): Promise<Result> {
  try {
    return await action(token, personId);
  } catch {
    return { ok: false, error: TRY_AGAIN };
  }
}

/**
 * The card above a shared list for anyone but its owner (ALL-123): add the
 * owner to your people, link someone you already have, or see who it's linked
 * to and remove that link. Signed out, it points to sign in or request access.
 */
export function ListCard({
  state,
  token,
  displayName,
  candidates,
  linked,
  linkAction,
  unlinkAction,
}: {
  state: "signed-out" | "add" | "linked";
  token: string;
  /** The list owner's display name, or null when they haven't set one. */
  displayName: string | null;
  /** The buyer's people with no list linked, for the picker. */
  candidates: { id: string; name: string }[];
  linked: { id: string; name: string; sharedAddress: boolean } | null;
  /** `linkFromShareAction` */
  linkAction: Action;
  /** `unlinkFromShareAction` */
  unlinkAction: Action;
}) {
  const addLabel = `Add ${displayName ?? "them"} to your people`;

  return (
    <section aria-label="This list and your people" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      {state === "signed-out" && <SignedOut token={token} addLabel={addLabel} />}
      {state === "add" && <Add token={token} addLabel={addLabel} candidates={candidates} linkAction={linkAction} />}
      {state === "linked" && linked && <Linked token={token} linked={linked} unlinkAction={unlinkAction} />}
    </section>
  );
}

function SignedOut({ token, addLabel }: { token: string; addLabel: string }) {
  const loginHref = `/auth/login?next=${encodeURIComponent(`/share/${token}`)}`;
  return (
    <>
      <Button asChild className="self-start">
        <Link href={loginHref}>{addLabel}</Link>
      </Button>
      <p className="flex flex-wrap gap-x-4 text-[13px]">
        <Link href={loginHref} className="inline-flex min-h-11 items-center underline underline-offset-[3px]">
          Sign in
        </Link>
        {/* Never carries the share token or a return path (T42, AC-24). */}
        <Link href="/request-access" className="inline-flex min-h-11 items-center underline underline-offset-[3px]">
          Request access
        </Link>
      </p>
    </>
  );
}

function Add({
  token,
  addLabel,
  candidates,
  linkAction,
}: {
  token: string;
  addLabel: string;
  candidates: { id: string; name: string }[];
  linkAction: Action;
}) {
  const [personId, setPersonId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    if (busy || !personId) return;
    setBusy(true);
    setError(null);
    const result = await attempt(linkAction, token, personId);
    setBusy(false);
    // On success the action revalidates this page and the card turns to "is in your people".
    if (!result.ok) setError(result.error);
  }

  return (
    <>
      <Button asChild className="self-start">
        <Link href={`/people/new?list=${token}`}>{addLabel}</Link>
      </Button>
      {/* Hidden, not empty, when nobody is left to link (Review 4). */}
      {candidates.length > 0 && (
        <form
          className="flex flex-col gap-1.5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void link();
          }}
        >
          <Label htmlFor="link-person">{PICKER_LABEL}</Label>
          <div className="flex items-center gap-2">
            <NativeSelect id="link-person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">Choose someone</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" disabled={busy || !personId}>
              Link
            </Button>
          </div>
        </form>
      )}
      {/* Decision 53: what spends money says so, on every way to link (AC-19). */}
      <p className="text-[13px] text-muted-foreground">If a gift for them is waiting on an address, it will ship to this list&apos;s owner.</p>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

function Linked({
  token,
  linked,
  unlinkAction,
}: {
  token: string;
  linked: { id: string; name: string; sharedAddress: boolean };
  unlinkAction: Action;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { name } = linked;

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await attempt(unlinkAction, token, linked.id);
    setBusy(false);
    // On success the action revalidates this page and the card goes back to "Add".
    if (result.ok) setOpen(false);
    else setError(result.error);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[15px] font-semibold [overflow-wrap:anywhere]">
        <Link href={`/people/${linked.id}`} className="underline underline-offset-[3px]">
          {name}
        </Link>{" "}
        is in your people
      </p>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" variant="outline">
            Remove
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink {name}&apos;s list?</DialogTitle>
            <DialogDescription>{name} stays in your people with their occasions, budgets and saved gifts.</DialogDescription>
            {/* The shared address is the owner's: unlinked, a waiting gift has nowhere to go (AC-22). */}
            {linked.sharedAddress && (
              <p className="text-[13px] text-muted-foreground">Gifts not yet ordered won&apos;t ship to their address.</p>
            )}
          </DialogHeader>
          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirm()}>
              Unlink
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
