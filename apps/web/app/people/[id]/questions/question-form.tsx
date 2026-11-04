"use client";

import { useState } from "react";
import { unstable_rethrow } from "next/navigation";
import type { GuidedQuestion } from "@gifts-af/core";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Guided questions on the phone (ALL-26, C-4). The text lives in state, not the
// form: React clears a form after its action, and a refused answer must stay put.

type Result = { ok: true } | { ok: false; error: string; key?: string };
type Action = (previous: null, formData: FormData) => Promise<Result>;

export function QuestionForm({
  personId,
  name,
  questions,
  answerAction,
  skipAction,
}: {
  personId: string;
  name: string;
  questions: readonly GuidedQuestion[];
  /** `answerQuestionsAction`: redirects to the person's page when it saves. */
  answerAction: Action;
  /** `skipQuestionAction` */
  skipAction: Action;
}) {
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; key?: string } | null>(null);

  async function run(action: Action, form: FormData) {
    if (busy) return;
    setBusy(true);
    setError(null);
    form.set("personId", personId);
    let result: Result;
    try {
      result = await action(null, form);
    } catch (e) {
      // A successful save redirects from the server, which reaches us as a throw.
      unstable_rethrow(e);
      result = { ok: false, error: "That didn't go through. Try again." };
    }
    setBusy(false);
    if (!result.ok) setError({ message: result.error, key: result.key });
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    const form = new FormData();
    for (const q of questions) form.set(q.key, text[q.key] ?? "");
    void run(answerAction, form);
  }

  function skip(key: string) {
    const form = new FormData();
    form.set("key", key);
    void run(skipAction, form);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <p className="text-[15px] text-muted-foreground">
        Answer what you can about {name}. Only you see these, and you can change them later.
      </p>
      {questions.map((q) => {
        const id = `question-${q.key}`;
        return (
          <div key={q.key} className="flex flex-col gap-1.5">
            <Label htmlFor={id} className="text-[15px] font-semibold">
              {q.prompt}
            </Label>
            <textarea
              id={id}
              rows={2}
              value={text[q.key] ?? ""}
              onChange={(e) => setText((t) => ({ ...t, [q.key]: e.target.value }))}
              aria-describedby={`${id}-hint`}
              aria-invalid={error?.key === q.key ? true : undefined}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive"
            />
            <div className="flex items-center justify-between gap-2">
              <p id={`${id}-hint`} className="min-w-0 text-[13px] text-muted-foreground">
                {q.hint}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={busy}
                aria-label={`Skip: ${q.prompt}`}
                onClick={() => skip(q.key)}
              >
                Skip
              </Button>
            </div>
          </div>
        );
      })}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error.message}
        </p>
      )}
      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" className="w-full" disabled={busy} aria-busy={busy}>
          Save answers
        </Button>
      </div>
    </form>
  );
}
