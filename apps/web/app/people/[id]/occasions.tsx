"use client";

import { useState } from "react";
import { OCCASION_NAMES, shortDate } from "@/components/occasion-format";
import { Switch } from "@/components/ui/switch";
import type { PersonDetail, SaveResult } from "@/modules/concierge";

type Row = PersonDetail["occasions"][number];

function orderByLine(row: Row): string | null {
  if (!row.enabled) return null;
  if (!row.orderBy) return "Too late to ship";
  return `Order by ${shortDate(row.orderBy.date)}${row.orderBy.fast ? " with fast shipping" : ""}`;
}

/** Each occasion with a switch, its next date and when to order by. */
export function Occasions({
  personId,
  occasions,
  action,
}: {
  personId: string;
  occasions: Row[];
  /** `setOccasionEnabledAction` */
  action: (previous: null, formData: FormData) => Promise<SaveResult>;
}) {
  // What the user just chose, until the refreshed page catches up.
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function toggle(kind: string, enabled: boolean) {
    setError(null);
    setChosen((c) => ({ ...c, [kind]: enabled }));
    const form = new FormData();
    form.set("id", personId);
    form.set("kind", kind);
    form.set("enabled", String(enabled));
    let result: SaveResult;
    try {
      result = await action(null, form);
    } catch {
      result = { ok: false, error: "That didn't save. Try again." };
    }
    if (!result.ok) {
      setError(result.error);
      setChosen((c) => {
        const { [kind]: _undone, ...rest } = c;
        void _undone;
        return rest;
      });
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="occasions-heading">
      <h2 id="occasions-heading" className="text-lg font-semibold">
        Occasions
      </h2>
      <ul className="flex flex-col gap-2">
        {occasions.map((row) => {
          const enabled = chosen[row.kind] ?? row.enabled;
          // The server's order-by is only right for the server's switch position.
          const line = enabled === row.enabled ? orderByLine(row) : null;
          return (
            <li key={row.kind} className="flex min-h-11 items-center gap-3 rounded-lg border bg-card p-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{OCCASION_NAMES[row.kind]}</p>
                <p className="text-[13px] text-muted-foreground">{shortDate(row.date)}</p>
                {line && <p className="text-[13px] text-muted-foreground">{line}</p>}
              </div>
              <Switch
                checked={enabled}
                aria-label={OCCASION_NAMES[row.kind]}
                onCheckedChange={(next) => void toggle(row.kind, next)}
              />
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
