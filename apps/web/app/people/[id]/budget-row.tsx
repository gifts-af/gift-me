import { OCCASION_NAMES } from "@/components/occasion-format";
import { SettingsRow } from "@/app/settings/settings-row";
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

/** Budget on a person's page, as a row that opens the Budget screen (T71), in the Gifts group (ALL-127). */
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
    <SettingsRow href={`/people/${personId}/budget`} label="Budget" value={budgetSummary(baseCents, defaultCents, occasions)} />
  );
}
