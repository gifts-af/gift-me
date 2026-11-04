"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ExternalLink, Pencil } from "lucide-react";
import { CATEGORY_GROUPS } from "@gifts-af/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Profile, ProfileFact, SaveResult } from "@/modules/concierge";

// "What we know" on a person's page (ALL-26, C-7, D51): one list by category,
// each fact with its source and a pencil that opens Save, Turn off and Delete.

export type Knowledge = Pick<Profile, "groups" | "off" | "unread">;

type Action = (previous: null, formData: FormData) => Promise<SaveResult>;

type Run = (action: Action, fields: Record<string, string>) => Promise<boolean>;

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
  const { groups, off, unread } = knowledge;

  const run: Run = async (action, fields) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("personId", personId);
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    let result: SaveResult;
    try {
      result = await action(null, form);
    } catch {
      result = { ok: false, error: "That didn't work. Try again." };
    }
    setBusy(false);
    if (!result.ok) setError(result.error);
    return result.ok;
  };

  const rowActions = { busy, run, editAction, setActiveAction, deleteAction };

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
              or capture a page about {name} with the extension.
            </>
          ) : (
            <>Capture a page about {name} with the extension and we&apos;ll learn from it.</>
          )}
        </p>
      )}

      {groups.map((g) => (
        <section key={g.category} className="flex flex-col gap-1" aria-labelledby={`facts-${g.category}`}>
          <h3 id={`facts-${g.category}`} className="text-[15px] font-semibold">
            {g.label}
          </h3>
          <ul className="flex flex-col divide-y divide-border">
            {g.facts.map((f) => (
              <FactRow key={f.id} fact={f} {...rowActions} />
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
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(readAction, {})}>
            {unread === 1 ? "Read it now" : "Read them now"}
          </Button>
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
            It&apos;s erased for good. A later capture could suggest it again. To keep it from coming back, keep it turned off instead.
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

function FactRow({
  fact,
  busy,
  run,
  editAction,
  setActiveAction,
  deleteAction,
}: { fact: ProfileFact; busy: boolean; run: Run } & Omit<Actions, "readAction">) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(fact.value);
  const [category, setCategory] = useState<string>(fact.category);
  const [confirming, setConfirming] = useState(false);

  if (!editing) {
    return (
      <li className="flex items-start justify-between gap-2 py-1">
        <div className="min-w-0 py-1.5">
          <p className="break-words text-[15px]">{fact.value}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
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
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label={`Edit ${fact.value}`}
          onClick={() => {
            setValue(fact.value);
            setCategory(fact.category);
            setEditing(true);
          }}
        >
          <Pencil aria-hidden="true" />
        </Button>
      </li>
    );
  }

  const fieldId = `fact-${fact.id}`;
  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${fieldId}-value`}>Fact</Label>
        <Input id={`${fieldId}-value`} value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${fieldId}-category`}>Kind</Label>
        <select
          id={`${fieldId}-category`}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="min-h-11 rounded-xl border border-input bg-background px-3 text-base"
        >
          {CATEGORY_GROUPS.map((g) => (
            <option key={g.category} value={g.category}>
              {g.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={async () => {
            if (await run(editAction, { id: fact.id, value, category })) setEditing(false);
          }}
        >
          Save
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void run(setActiveAction, { id: fact.id, active: "false" })}
        >
          Turn off
        </Button>
        <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => setConfirming(true)}>
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
