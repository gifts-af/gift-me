import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { OCCASION_NAMES } from "@/components/occasion-format";
import type { PersonDetail } from "@/modules/concierge";
import { money } from "./money";

type Occasion = PersonDetail["occasions"][number];

/**
 * The row's value (ALL-120): the base, then switched-on occasions with their
 * own amounts. With no base, the relationship default; with nothing, "Not set".
 */
export function budgetSummary(baseCents: number | null, defaultCents: number | null, occasions: Occasion[]): string {
  const own = occasions
    .filter((o) => o.enabled && o.budgetCents !== null)
    .map((o) => `${OCCASION_NAMES[o.kind]} ${money(o.budgetCents!)}`);
  const first = baseCents !== null ? money(baseCents) : own.length === 0 && defaultCents !== null ? `${money(defaultCents)} default` : null;
  const parts = [...(first ? [first] : []), ...own];
  return parts.length > 0 ? parts.join(" · ") : "Not set";
}

/**
 * Budget on a person's page, as a row that opens the Budget screen (T71).
 * Looks like Settings' rows (ALL-115's SettingsRow); share one component once
 * both have landed.
 */
export function BudgetRow({
  personId,
  baseCents,
  defaultCents,
  occasions,
}: {
  personId: string;
  baseCents: number | null;
  defaultCents: number | null;
  occasions: Occasion[];
}) {
  return (
    <Link
      href={`/people/${personId}/budget`}
      className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border px-4"
    >
      <span className="text-[15px]">Budget</span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate text-[15px] text-muted-foreground">{budgetSummary(baseCents, defaultCents, occasions)}</span>
        <ChevronRight className="size-5 flex-none text-muted-foreground" aria-hidden="true" />
      </span>
    </Link>
  );
}
