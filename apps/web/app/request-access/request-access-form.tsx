"use client";

import { useActionState } from "react";
import { submitAccessRequest } from "./actions";

const input =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2.5 text-base font-normal aria-[invalid=true]:border-destructive";

export function RequestAccessForm() {
  const [result, action, pending] = useActionState(submitAccessRequest, null);

  if (result?.status === "sent") {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-2xl border bg-card p-5 text-center text-card-foreground">
        <p className="text-[18px] font-bold">Thanks! We&apos;ll email you when you&apos;re in.</p>
        <p className="text-[15px] text-muted-foreground">Usually within a day or two. Meanwhile, the tour is always open.</p>
      </div>
    );
  }

  const errors = result?.status === "invalid" ? result.errors : {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <label className="grid gap-1.5 text-[14px] font-semibold" htmlFor="ra-name">
        Name
        <input
          id="ra-name"
          name="name"
          required
          autoComplete="name"
          className={input}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? "ra-name-error" : undefined}
        />
        {errors.name && (
          <span id="ra-name-error" className="text-[13px] font-normal text-destructive">
            {errors.name}
          </span>
        )}
      </label>
      <label className="grid gap-1.5 text-[14px] font-semibold" htmlFor="ra-email">
        Email
        <input
          id="ra-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          className={input}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "ra-email-error" : undefined}
        />
        {errors.email && (
          <span id="ra-email-error" className="text-[13px] font-normal text-destructive">
            {errors.email}
          </span>
        )}
      </label>
      <label className="grid gap-1.5 text-[14px] font-semibold" htmlFor="ra-note">
        <span>
          Anything we should know? <span className="font-normal text-muted-foreground">Optional</span>
        </span>
        <textarea id="ra-note" name="note" rows={3} className={`${input} min-h-20 resize-y`} />
      </label>
      {/* A trap for bots: hidden from people and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <input name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {result?.status === "error" && (
        <p role="alert" className="text-[14px] text-destructive">
          {result.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="min-h-12 rounded-lg bg-primary font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-45"
      >
        {pending ? "Sending…" : "Request access"}
      </button>
    </form>
  );
}
