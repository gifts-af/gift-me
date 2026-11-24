"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RATING_LABELS, RATINGS, type Rating } from "@gifts-af/core";
import { IdeaPhoto } from "@/components/idea-photo";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import type { ReactionView } from "@/modules/concierge";
import type { SaveReactionResult } from "../../actions";

// One card per delivered gift, each with its own answer, note and Save, so saving one leaves what's
// typed on the others alone. What's typed lives in state: React clears a form after its action.

type Gift = ReactionView["gifts"][number];
type SaveAction = (orderId: string, form: FormData) => Promise<SaveReactionResult>;

export type ReactionFormProps = {
  gifts: Gift[];
  noteMaxChars: number;
  /** The gift the link was about, and the answer it carried: chosen, never saved. */
  opened: { orderId: string; rating: Rating | null } | null;
  /** Null when the person was removed. */
  personName: string | null;
  personId: string;
  /** `saveReactionAction` */
  saveAction: SaveAction;
};

export function ReactionForm({ gifts, noteMaxChars, opened, personName, personId, saveAction }: ReactionFormProps) {
  const [answered, setAnswered] = useState(() => new Set(gifts.filter((g) => g.rating !== null).map((g) => g.orderId)));
  const allAnswered = gifts.every((g) => answered.has(g.orderId));

  return (
    <>
      <ul className="flex flex-col gap-3">
        {gifts.map((g) => (
          <GiftCard
            key={g.orderId}
            gift={g}
            noteMaxChars={noteMaxChars}
            opened={opened?.orderId === g.orderId}
            chosen={opened?.orderId === g.orderId ? opened.rating : null}
            saveAction={saveAction}
            onSaved={() => setAnswered((a) => new Set(a).add(g.orderId))}
          />
        ))}
      </ul>
      {allAnswered && (
        <Button asChild variant="outline">
          {personName ? (
            <Link href={`/people/${personId}`} className="max-w-full whitespace-normal [overflow-wrap:anywhere]">
              Back to {personName}
            </Link>
          ) : (
            <Link href="/">Go to your people</Link>
          )}
        </Button>
      )}
    </>
  );
}

function GiftCard({
  gift,
  noteMaxChars,
  opened,
  chosen,
  saveAction,
  onSaved,
}: {
  gift: Gift;
  noteMaxChars: number;
  opened: boolean;
  chosen: Rating | null;
  saveAction: SaveAction;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState<{ rating: Rating | null; note: string }>({ rating: gift.rating, note: gift.note ?? "" });
  const [rating, setRating] = useState<Rating | null>(chosen ?? gift.rating);
  const [note, setNote] = useState(gift.note ?? "");
  const [justSaved, setJustSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; noteAtFault: boolean } | null>(null);
  // Set at once, so a second tap before the next render can't save twice.
  const busy = useRef(false);
  const hydrated = useHydrated();
  const card = useRef<HTMLLIElement>(null);
  const id = `gift-${gift.orderId}`;

  // Once: Next keeps this page while you're elsewhere and runs effects again when it shows.
  const shown = useRef(false);
  useEffect(() => {
    if (!opened || shown.current) return;
    shown.current = true;
    card.current?.scrollIntoView({ block: "nearest" });
  }, [opened]);

  const changed = rating !== saved.rating || note !== saved.note;
  const ready = changed && rating !== null && !pending;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || rating === null || !changed) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setJustSaved(false);
    const form = new FormData();
    form.set("rating", rating);
    form.set("note", note);
    let result: SaveReactionResult;
    try {
      result = await saveAction(gift.orderId, form);
    } catch {
      result = { ok: false, reason: "failed", error: "That didn't save. Try again." };
    }
    busy.current = false;
    setPending(false);
    if (!result.ok) {
      setError({ message: result.error, noteAtFault: result.reason === "sensitive" || result.reason === "note_too_long" });
      return;
    }
    // What was sent, which may no longer be what's on the screen.
    setSaved({ rating, note });
    setJustSaved(true);
    onSaved();
  }

  return (
    <li ref={card} aria-labelledby={`${id}-title`} className="scroll-my-4 rounded-xl border border-border p-3">
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex-none">
            <IdeaPhoto url={gift.imageUrl} title="" />
          </span>
          <h2 id={`${id}-title`} className="min-w-0 text-[15px] font-semibold [overflow-wrap:anywhere]">
            {gift.title}
          </h2>
        </div>
        <fieldset aria-label={`How did ${gift.title} go?`} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {RATINGS.map((r) => (
            <label
              key={r}
              className="relative flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-input px-2 py-2 text-center text-[15px] font-semibold has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:checked]:ring-1 has-[:checked]:ring-primary has-[:disabled]:opacity-45 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
            >
              <input
                type="radio"
                name={`${id}-rating`}
                value={r}
                checked={rating === r}
                disabled={!hydrated}
                onChange={() => setRating(r)}
                className="absolute inset-0 cursor-pointer appearance-none rounded-lg outline-none"
              />
              {RATING_LABELS[r]}
            </label>
          ))}
        </fieldset>
        <label htmlFor={`${id}-note`} className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
          Note (optional)
          <textarea
            id={`${id}-note`}
            rows={2}
            maxLength={noteMaxChars}
            value={note}
            disabled={!hydrated}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={error?.noteAtFault ? true : undefined}
            aria-describedby={error?.noteAtFault ? `${id}-error` : undefined}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-45 aria-invalid:border-destructive"
          />
        </label>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-[13px] text-destructive">
            {error.message}
          </p>
        )}
        <p role="status" className="min-h-5 text-[13px]">
          {changed && rating === null ? (
            <span className="text-muted-foreground">Choose an answer to save.</span>
          ) : ready ? (
            <span className="text-muted-foreground">Not saved yet.</span>
          ) : !changed && justSaved ? (
            <span className="font-semibold text-success">Saved. Thanks for telling us.</span>
          ) : !changed && rating !== null ? (
            <span className="text-muted-foreground">Saved. You can change it.</span>
          ) : null}
        </p>
        {/* aria-disabled, not disabled, which would drop focus as the save starts. */}
        <Button
          type="submit"
          size="sm"
          variant={ready ? "default" : "outline"}
          aria-label={`Save: ${gift.title}`}
          aria-disabled={!ready}
          aria-busy={pending}
        >
          Save
        </Button>
      </form>
    </li>
  );
}
