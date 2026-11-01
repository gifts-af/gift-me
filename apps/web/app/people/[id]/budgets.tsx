"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { OCCASION_NAMES } from "@/components/occasion-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PersonDetail, SaveResult } from "@/modules/concierge";

type Row = PersonDetail["occasions"][number];

/** "$75" or "$75.50". */
function money(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `$${whole}` : `$${whole}.${String(rest).padStart(2, "0")}`;
}

function BudgetRow({
  personId,
  row,
  action,
}: {
  personId: string;
  row: Row;
  action: (previous: null, formData: FormData) => Promise<SaveResult>;
}) {
  const name = OCCASION_NAMES[row.kind];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open() {
    setValue(row.budgetCents === null ? "" : money(row.budgetCents).slice(1));
    setError(null);
    setEditing(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("id", personId);
    form.set("kind", row.kind);
    form.set("budget", value);
    let result: SaveResult;
    try {
      result = await action(null, form);
    } catch {
      result = { ok: false, error: "That didn't save. Try again." };
    }
    setBusy(false);
    if (result.ok) setEditing(false);
    else setError(result.error);
  }

  if (!editing) {
    return (
      <li className="flex min-h-11 items-center gap-3">
        <span className="flex-1 text-[15px]">{name}</span>
        <span className={row.budgetCents === null ? "text-[15px] text-muted-foreground" : "text-[15px] font-semibold"}>
          {row.budgetCents === null ? "Not set" : money(row.budgetCents)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={`${row.budgetCents === null ? "Set" : "Edit"} ${name} budget`}
          onClick={open}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
      </li>
    );
  }

  return (
    <li>
      <form onSubmit={save} className="flex flex-col gap-1.5" noValidate>
        <Label htmlFor={`budget-${row.kind}`}>{name} budget</Label>
        <div className="flex items-center gap-2">
          <span aria-hidden="true">$</span>
          <Input
            id={`budget-${row.kind}`}
            inputMode="decimal"
            placeholder="None"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
      </form>
    </li>
  );
}

/** One optional amount per switched-on occasion. Only the user sees it. */
export function Budgets({
  personId,
  occasions,
  action,
}: {
  personId: string;
  occasions: Row[];
  /** `setBudgetAction` */
  action: (previous: null, formData: FormData) => Promise<SaveResult>;
}) {
  const enabled = occasions.filter((o) => o.enabled);
  return (
    <section className="flex flex-col gap-2" aria-labelledby="budget-heading">
      <h2 id="budget-heading" className="text-lg font-semibold">
        Your budget
      </h2>
      <p className="text-[13px] text-muted-foreground">Optional. Only you see it.</p>
      <ul className="flex flex-col">
        {enabled.map((row) => (
          <BudgetRow key={row.kind} personId={personId} row={row} action={action} />
        ))}
      </ul>
    </section>
  );
}
