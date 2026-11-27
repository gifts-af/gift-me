import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { OCCASION_NAMES } from "@/lib/occasion-format";
import { cn } from "@/lib/utils";
import type { GiftInProgress } from "@/modules/concierge";

// The words carry the status; the colour only repeats it.
const TONES: Record<GiftInProgress["line"]["tone"], string> = {
  ready: "font-semibold text-primary",
  warn: "font-semibold text-warning",
  muted: "text-muted-foreground",
};

/** One row per gift in progress, each opening its round. On the gifts page a row leads with the person. */
export function GiftsInProgress({ gifts, withPerson }: { gifts: GiftInProgress[]; withPerson: boolean }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {gifts.map((g) => {
        const occasion = g.occasionKind && OCCASION_NAMES[g.occasionKind];
        const title = withPerson ? `${g.personName} · ${occasion ?? "Gift"}` : occasion ? `${occasion} gift` : "Gift";
        return (
          <li key={g.roundId}>
            <Link href={`/rounds/${g.roundId}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{title}</span>{" "}
                <span className={cn("text-[13px]", TONES[g.line.tone])}>{g.line.text}</span>
              </span>
              <ChevronRight className="size-5 flex-none text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
