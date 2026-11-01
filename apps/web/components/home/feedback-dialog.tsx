"use client";

import { useActionState, useEffect, useState } from "react";
import { submitFeedback } from "@/app/feedback/actions";
import { useHumanCheck } from "@/components/human-check";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  useSelfClosingDialog,
} from "@/components/ui/dialog";

const input =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2.5 text-base font-normal aria-[invalid=true]:border-destructive";

// "Send feedback" opens a "sad story" box over the page that emails us
// directly (ALL-53), instead of opening the visitor's email app.
export function FeedbackButton({ className }: { className?: string }) {
  const { open, onOpenChange, closeSoon } = useSelfClosingDialog();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger className={className}>Send feedback</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tell us the sad story</DialogTitle>
          <DialogDescription>What broke, or what bugged you? It goes straight to Jim and Aaron.</DialogDescription>
        </DialogHeader>
        <FeedbackForm onSent={closeSoon} />
      </DialogContent>
    </Dialog>
  );
}

function FeedbackForm({ onSent }: { onSent: () => void }) {
  const [result, action, pending] = useActionState(submitFeedback, null);
  const human = useHumanCheck();
  const { reset } = human;
  // A send attempt uses up the token, so fetch a new one before the next try.
  // A form that failed our own checks never reached Cloudflare, so its token is still good.
  useEffect(() => {
    if (result?.status === "error") reset();
  }, [result, reset]);
  // Held in state so a failed send doesn't wipe what they typed (React resets
  // a form's own fields after its action runs).
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const sent = result?.status === "sent";
  useEffect(() => {
    if (sent) onSent();
  }, [sent, onSent]);

  if (sent) {
    return (
      <div role="status" className="flex flex-col gap-1 rounded-2xl bg-accent p-5 text-accent-foreground">
        <p className="text-[18px] font-bold">Thanks. Got it.</p>
        <p className="text-[15px]">It&apos;s in our inbox. This closes itself in a few seconds.</p>
      </div>
    );
  }

  const errors = result?.status === "invalid" ? result.errors : {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <label className="grid gap-1.5 text-[14px] font-semibold" htmlFor="fb-message">
        What happened?
        <textarea
          id="fb-message"
          name="message"
          required
          rows={5}
          placeholder="The share link opened a blank page when I…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={`${input} min-h-32 resize-y`}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? "fb-message-error" : undefined}
        />
        {errors.message && (
          <span id="fb-message-error" className="text-[13px] font-normal text-destructive">
            {errors.message}
          </span>
        )}
      </label>
      <label className="grid gap-1.5 text-[14px] font-semibold" htmlFor="fb-email">
        <span>
          Your email <span className="font-normal text-muted-foreground">Optional, if you&apos;d like a reply</span>
        </span>
        <input
          id="fb-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={input}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "fb-email-error" : undefined}
        />
        {errors.email && (
          <span id="fb-email-error" className="text-[13px] font-normal text-destructive">
            {errors.email}
          </span>
        )}
      </label>
      {/* A trap for bots: hidden from people and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <input name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {human.widget}
      {result?.status === "error" && (
        <p role="alert" className="text-[14px] text-destructive">
          {result.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !human.token}
        className="min-h-12 rounded-lg bg-primary font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-45"
      >
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
