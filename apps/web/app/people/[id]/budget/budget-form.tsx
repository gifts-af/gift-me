"use client";

import { useRouter } from "next/navigation";
import { useGoBack } from "@/components/app-shell/back-history";
import { useEffect, useRef, useState } from "react";
import { OCCASION_NAMES } from "@/components/occasion-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PersonDetail } from "@/modules/concierge";
import { money } from "../money";

// The Budget screen (ALL-120, T71): a base for any occasion, an optional
// amount for each switched-on occasion, and one Save, since this is money.

type Occasion = PersonDetail["occasions"][number];

export type BudgetsResult = { ok: true } | { ok: false; error?: string; errors?: Record<string, string> };

const CARD_CLASS = "flex flex-col gap-4 rounded-xl border border-border p-4";

function amountText(cents: number | null): string {
  return cents === null ? "" : money(cents).slice(1);
}

function Amount({
  id,
  label,
  defaultValue,
  placeholder,
  error,
  help,
}: {
  id: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  error?: string;
  help?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`budget-${id}`}>{label}</Label>
      <div className="flex items-center gap-2">
        <span aria-hidden="true">$</span>
        <Input
          id={`budget-${id}`}
          name={id}
          inputMode="decimal"
          autoComplete="off"
          defaultValue={defaultValue}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `budget-${id}-error` : undefined}
        />
      </div>
      {help && <p className="text-[13px] text-muted-foreground">{help}</p>}
      {error && (
        <p id={`budget-${id}-error`} className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function BudgetForm({
  personId,
  name,
  baseCents,
  defaultCents,
  occasions,
  action,
}: {
  personId: string;
  name: string;
  baseCents: number | null;
  defaultCents: number | null;
  /** Switched-on occasions only: the rest are left as they are. */
  occasions: Occasion[];
  /** `saveBudgetsAction` */
  action: (previous: null, formData: FormData) => Promise<BudgetsResult>;
}) {
  const router = useRouter();
  // Back to where you were on their page, if you came from it (ALL-131).
  const goBack = useGoBack(`/people/${personId}`);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const fallback = baseCents ?? defaultCents;
  const formRef = useRef<HTMLFormElement>(null);

  // Leaving without saving means cancel. The app can keep this screen hidden
  // and show it again, so on hide the fields go back to what's saved.
  useEffect(() => {
    const form = formRef.current;
    return () => {
      form?.reset();
      setErrors({});
      setError(null);
    };
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setError(null);
    // From the fields themselves, so text typed before the page was ready counts.
    const form = new FormData(event.currentTarget);
    form.set("id", personId);
    let result: BudgetsResult;
    try {
      result = await action(null, form);
    } catch {
      result = { ok: false, error: "That didn't save. Try again." };
    }
    // Ready again either way: the app can keep this screen and show it again.
    setBusy(false);
    if (result.ok) {
      if (!goBack()) router.push(`/people/${personId}`);
      return;
    }
    setErrors(result.errors ?? {});
    setError(result.error ?? null);
  }

  return (
    <form ref={formRef} onSubmit={save} noValidate className="flex flex-col gap-4">
      <div className={CARD_CLASS}>
        <Amount
          id="any"
          label="Any occasion"
          defaultValue={amountText(baseCents)}
          help={`What you usually spend on ${name}.`}
          error={errors.any}
        />
      </div>
      {occasions.length > 0 && (
        <div className={CARD_CLASS}>
          <p className="text-[15px] font-semibold">
            Different for an occasion? <span className="font-normal text-muted-foreground">Optional</span>
          </p>
          {occasions.map((o) => (
            <Amount
              key={o.kind}
              id={o.kind}
              label={OCCASION_NAMES[o.kind]}
              defaultValue={amountText(o.budgetCents)}
              placeholder={fallback === null ? "None" : `Uses ${money(fallback)}`}
              error={errors[o.kind]}
            />
          ))}
        </div>
      )}
      <Button type="submit" disabled={busy}>
        Save
      </Button>
      <p className="text-[13px] text-muted-foreground">
        Leave an occasion empty to use the amount above. Rounds already started keep their budget.
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
