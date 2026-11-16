"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { CAPTURE_READ_OFF, CATEGORY_GROUPS, captureReadNotice, type FactCategory } from "@gifts-af/core";
import { ExtensionLink } from "@/components/extension-link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useAutosave } from "@/lib/use-autosave";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import type { Profile, ProfileFact, SaveResult } from "@/modules/concierge";
import { confirmFactAction } from "../actions";

// "What we know" on a person's page (ALL-26, C-7, D51): one list by category,
// each fact with its source. Tapping a fact opens it in place, and it saves as
// you go (ALL-127, T71): the text on leaving the field or Enter, the kind when
// picked, "Use for gift ideas" when flipped. A ✨ fact gets "Looks right".

export type Knowledge = Pick<Profile, "groups" | "off" | "unread" | "captureRead">;

type Action = (previous: null, formData: FormData) => Promise<SaveResult>;

type Send = (action: Action, fields: Record<string, string>) => Promise<SaveResult>;

type Run = (action: Action, fields: Record<string, string>, onError?: (message: string) => void) => Promise<boolean>;

type Actions = {
  /** `editFactAction` */
  editAction: Action;
  /** `setFactActiveAction` */
  setActiveAction: Action;
  /** `deleteFactAction` */
  deleteAction: Action;
  /** `readCapturesAction` */
  readAction: Action;
};

/** The open fact, and the group and place it was opened in. */
type Open = { id: string; category: FactCategory; index: number };

const EMPTY = "Type something first.";

/**
 * The groups to show. An open fact stays where it was opened until it's closed,
 * even after a save moves it to another kind or turns it off, so the editor
 * (and its "Saved") doesn't jump away mid-edit.
 */
function arrange(knowledge: Knowledge, open: Open | null) {
  const active = knowledge.groups.flatMap((g) => g.facts);
  const pinned = open ? [...active, ...knowledge.off].find((f) => f.id === open.id) : undefined;
  const offIds = new Set(knowledge.off.map((f) => f.id));
  const groups = CATEGORY_GROUPS.map((g) => {
    const facts = active.filter((f) => f.category === g.category && f.id !== pinned?.id);
    if (pinned && open?.category === g.category) facts.splice(Math.min(open.index, facts.length), 0, pinned);
    return { ...g, facts };
  }).filter((g) => g.facts.length > 0);
  return {
    groups,
    off: knowledge.off.filter((f) => f.id !== pinned?.id),
    isOff: (id: string) => offIds.has(id),
  };
}

export function WhatWeKnow({
  personId,
  name,
  knowledge,
  questionsHref,
  editAction,
  setActiveAction,
  deleteAction,
  readAction,
}: {
  personId: string;
  name: string;
  knowledge: Knowledge;
  /** Where the empty state points; null when questions are off or none are open. */
  questionsHref: string | null;
} & Actions) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const { unread, captureRead } = knowledge;
  const { groups, off, isOff } = arrange(knowledge, open);

  const send: Send = async (action, fields) => {
    const form = new FormData();
    form.set("personId", personId);
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return action(null, form);
  };

  const run: Run = async (action, fields, onError = setError) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    let result: SaveResult;
    try {
      result = await send(action, fields);
    } catch {
      result = { ok: false, error: "That didn't work. Try again." };
    }
    setBusy(false);
    if (!result.ok) onError(result.error);
    return result.ok;
  };

  return (
    <section className="flex flex-col gap-4 border-b border-border pb-6" aria-labelledby="know-heading">
      <h2 id="know-heading" className="text-lg font-semibold">
        What we know
      </h2>

      {groups.length === 0 && (
        <p className="text-[15px] text-muted-foreground">
          Nothing yet.{" "}
          {questionsHref ? (
            <>
              <Link href={questionsHref} className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline">
                Answer a few questions
              </Link>{" "}
              or capture a page about {name} with <ExtensionLink>the extension</ExtensionLink>.
            </>
          ) : (
            <>Capture a page about {name} with <ExtensionLink>the extension</ExtensionLink> and we&apos;ll learn from it.</>
          )}
        </p>
      )}

      {groups.map((g) => (
        <section key={g.category} className="flex flex-col gap-1" aria-labelledby={`facts-${g.category}`}>
          <h3 id={`facts-${g.category}`} className="text-[15px] font-semibold">
            {g.label}
          </h3>
          <ul className="flex flex-col divide-y divide-border">
            {g.facts.map((f, index) => (
              <FactRow
                key={f.id}
                fact={f}
                active={!isOff(f.id)}
                open={open?.id === f.id}
                onToggle={() => setOpen(open?.id === f.id ? null : { id: f.id, category: g.category, index })}
                onClose={() => setOpen(null)}
                busy={busy}
                send={send}
                run={run}
                editAction={editAction}
                setActiveAction={setActiveAction}
                deleteAction={deleteAction}
              />
            ))}
          </ul>
        </section>
      ))}

      {off.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden="true" />
            Turned off ({off.length})
          </summary>
          <p className="text-[13px] text-muted-foreground">These don&apos;t shape ideas, and we won&apos;t suggest them again.</p>
          <ul className="flex flex-col divide-y divide-border">
            {off.map((f) => (
              <OffRow key={f.id} fact={f} busy={busy} run={run} setActiveAction={setActiveAction} deleteAction={deleteAction} />
            ))}
          </ul>
        </details>
      )}

      {unread > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] text-muted-foreground">
            {unread === 1 ? "1 capture hasn't been read." : `${unread} captures haven't been read.`}
          </p>
          {captureRead ? (
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(readAction, {})}>
                {unread === 1 ? "Read it now" : "Read them now"}
              </Button>
              <p role="note" className="w-full rounded-md bg-warning-soft px-2.5 py-1.5 text-[13px] text-warning">
                {captureReadNotice(captureRead.estimateCents)}
              </p>
            </>
          ) : (
            <p className="w-full text-[13px] text-muted-foreground">{CAPTURE_READ_OFF}</p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function ConfirmDelete({
  open,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this?</DialogTitle>
          <DialogDescription>
            It&apos;s removed from their profile for good. A later capture could suggest it again. To keep it from coming back, keep it turned off instead.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void onConfirm()}>
            Delete for good
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OffRow({
  fact,
  busy,
  run,
  setActiveAction,
  deleteAction,
}: { fact: ProfileFact; busy: boolean; run: Run } & Pick<Actions, "setActiveAction" | "deleteAction">) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 py-1">
      <p className="min-w-0 break-words text-[15px] text-muted-foreground">{fact.value}</p>
      <div className="flex gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label={`Turn on ${fact.value}`}
          onClick={() => void run(setActiveAction, { id: fact.id, active: "true" })}
        >
          Turn on
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive"
          disabled={busy}
          aria-label={`Delete ${fact.value}`}
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
      </div>
      <ConfirmDelete
        open={confirming}
        busy={busy}
        onOpenChange={setConfirming}
        onConfirm={async () => {
          await run(deleteAction, { id: fact.id });
          setConfirming(false);
        }}
      />
    </li>
  );
}

type RowProps = {
  fact: ProfileFact;
  /** False once it's turned off while open. */
  active: boolean;
  busy: boolean;
  send: Send;
  run: Run;
  onClose: () => void;
} & Omit<Actions, "readAction">;

function FactRow({ open, onToggle, ...props }: RowProps & { open: boolean; onToggle: () => void }) {
  const { fact } = props;
  const hydrated = useHydrated();
  const editorId = useId();
  return (
    <li className="flex flex-col py-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? editorId : undefined}
        // Until the page's JavaScript loads a tap does nothing (ALL-110).
        aria-disabled={hydrated ? undefined : true}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md pt-1.5 text-left"
      >
        <span className="min-w-0 break-words text-[15px]">{fact.value}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      <p className="flex flex-wrap items-center gap-x-1.5 pb-1.5 text-[13px] text-muted-foreground">
        <span>{fact.sourceLabel}</span>
        {fact.sourceUrl && (
          <a
            href={fact.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 max-w-full items-center gap-1 underline-offset-2 hover:underline"
          >
            <span className="truncate">from &ldquo;{fact.sourceTitle || fact.sourceUrl}&rdquo;</span>
            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
          </a>
        )}
      </p>
      {open && <FactEditor id={editorId} {...props} />}
    </li>
  );
}

/** An open fact. Mounted only while open, so it starts from what's saved. */
function FactEditor({
  id,
  fact,
  active,
  busy,
  send,
  run,
  onClose,
  editAction,
  setActiveAction,
  deleteAction,
}: RowProps & { id: string }) {
  // Text and kind are one value, so every save carries both and neither can
  // put back the other's old value (`updateFact` writes both).
  const words = useAutosave<{ text: string; category: FactCategory }>({
    initial: { text: fact.value, category: fact.category },
    equals: (a, b) => a.text === b.text && a.category === b.category,
    save: async ({ text, category }) => {
      if (!text.trim()) return { ok: false, error: EMPTY };
      return send(editAction, { id: fact.id, value: text, category });
    },
  });
  const use = useAutosave<boolean>({
    initial: active,
    save: (on) => send(setActiveAction, { id: fact.id, active: String(on) }),
  });
  const [confirming, setConfirming] = useState(false);
  // Looks right and Delete. Shown here, where a phone is looking.
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  /** Done: waits for anything still saving and closes only if it saved (AC-9). */
  async function done() {
    setClosing(true);
    const results = await Promise.all([words.commit(), use.commit()]);
    setClosing(false);
    if (results.every((r) => r === null || r.ok)) onClose();
  }

  const statuses = [words.status, use.status];
  const status = statuses.includes("saving")
    ? "Saving…"
    : statuses.includes("saved") && !statuses.includes("error")
      ? "Saved"
      : "";
  const unconfirmedAi = fact.source === "capture" && !fact.confirmed;

  return (
    <div id={id} className="flex flex-col gap-3 pb-3 pt-1">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-value`}>Fact</Label>
        <Input
          id={`${id}-value`}
          value={words.value.text}
          onChange={(e) => words.setValue({ ...words.value, text: e.target.value })}
          onBlur={words.onBlur}
          onKeyDown={words.onKeyDown}
          aria-invalid={words.error ? true : undefined}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-category`}>Kind</Label>
        <NativeSelect
          id={`${id}-category`}
          value={words.value.category}
          onChange={(e) => void words.commit({ ...words.value, category: e.target.value as FactCategory })}
        >
          {CATEGORY_GROUPS.map((g) => (
            <option key={g.category} value={g.category}>
              {g.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Label htmlFor={`${id}-use`}>Use for gift ideas</Label>
        <Switch id={`${id}-use`} checked={use.value} onCheckedChange={(next) => void use.commit(next)} />
      </div>
      <p role="status" className="text-[13px] text-success">
        {status}
      </p>
      {[words.error, use.error, error].map(
        (message, i) =>
          message && (
            <p key={i} role="alert" className="text-[13px] text-destructive">
              {message}
            </p>
          ),
      )}
      <div className="flex flex-wrap gap-2">
        {unconfirmedAi && (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => {
              setError(null);
              void run(confirmFactAction, { id: fact.id }, setError);
            }}
          >
            Looks right
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" disabled={closing} onClick={() => void done()}>
          Done
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive"
          disabled={busy}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          Delete
        </Button>
      </div>
      <ConfirmDelete
        open={confirming}
        busy={busy}
        onOpenChange={setConfirming}
        onConfirm={async () => {
          const deleted = await run(deleteAction, { id: fact.id }, setError);
          setConfirming(false);
          if (!deleted) return;
          // Gone: nothing left to save, so closing never sends a failed edit again.
          words.reset(words.value);
          use.reset(use.value);
          onClose();
        }}
      />
    </div>
  );
}
