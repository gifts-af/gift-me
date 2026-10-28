"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SaveResult } from "@/modules/concierge";

export type SettingsValues = { timezone: string | null; overBudgetPct: number };
type Action = (previous: SaveResult | null, formData: FormData) => Promise<SaveResult>;

export function SettingsForm({ initial, action }: { initial: SettingsValues; action: Action }) {
  const [result, formAction, pending] = useActionState(action, null);
  const deviceZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  // Controlled, because React resets a form's uncontrolled fields after each
  // action: a failed save would wipe what was typed.
  const [timezone, setTimezone] = useState(initial.timezone ?? deviceZone);
  const [overBudgetPct, setOverBudgetPct] = useState(String(initial.overBudgetPct));
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    return all.includes(timezone) ? all : [timezone, ...all];
  }, [timezone]);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <section className="flex flex-col gap-1.5">
        <Label htmlFor="timezone">Time zone</Label>
        <p id="timezone-hint" className="text-[13px] text-muted-foreground">
          Reminders arrive in the morning, your time.
        </p>
        <select
          id="timezone"
          name="timezone"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          aria-describedby="timezone-hint"
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-base"
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </section>

      <section className="flex flex-col gap-1.5">
        <Label htmlFor="over-budget">
          Over-budget allowance <span className="font-normal text-muted-foreground">%</span>
        </Label>
        <p id="over-budget-hint" className="text-[13px] text-muted-foreground">
          When you set a budget, ideas up to this much over it are still shown, marked as over.
        </p>
        <Input
          id="over-budget"
          name="overBudgetPct"
          inputMode="numeric"
          value={overBudgetPct}
          onChange={(event) => setOverBudgetPct(event.target.value)}
          aria-describedby="over-budget-hint"
          className="num max-w-28"
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <p className="text-[15px]">By email</p>
        <p className="text-[13px] text-muted-foreground">More ways to be reminded are coming.</p>
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" disabled={pending} aria-busy={pending} className="w-full sm:w-auto">
          {pending ? "Saving…" : "Save"}
        </Button>
        {result?.ok && (
          <p role="status" className="text-[13px] text-success">
            Saved
          </p>
        )}
        {result && !result.ok && (
          <p role="alert" className="text-[13px] text-destructive">
            {result.error}
          </p>
        )}
      </div>
    </form>
  );
}
