import Link from "next/link";
import { RATING_LABELS, type CalendarDate } from "@gifts-af/core";
import { OCCASION_NAMES, shortDate } from "@/lib/occasion-format";
import type { PastGift, PastRound } from "@/modules/concierge";
import { money } from "../money";

/** "Sat, Mar 14, 2026": past rounds span years. */
const fullDate = (date: CalendarDate) => `${shortDate(date)}, ${date.slice(0, 4)}`;

function outcomeText(gift: PastGift): string {
  switch (gift.outcome) {
    case "delivered":
      return gift.deliveredAt ? `Delivered ${shortDate(gift.deliveredAt.slice(0, 10))}` : "Delivered";
    // A delivery can go unreported, so an old order isn't called "on its way".
    case "on_its_way":
      return "Ordered, not marked as delivered";
    case "being_bought":
      return "Order not confirmed";
    case "not_bought":
      return "Not bought";
    case "store_cancelled":
      return `The store cancelled it · ${gift.refundCents !== null ? `${money(gift.refundCents)} back in Zinc` : "the money is back in Zinc"}`;
  }
}

function GiftItem({ roundId, gift, ask }: { roundId: string; gift: PastGift; ask: boolean }) {
  const cost = gift.totalCents !== null ? money(gift.totalCents) : gift.outcome === "not_bought" ? null : "Cost not known yet";
  return (
    <li className="flex flex-col gap-0.5 p-3 [overflow-wrap:anywhere]">
      <span className="text-[15px] font-semibold">{gift.title}</span>
      {cost && <span className="text-[13px] text-muted-foreground tabular-nums">{cost}</span>}
      <span className="text-[13px] text-muted-foreground">{outcomeText(gift)}</span>
      {gift.rating && <span className="mt-1 text-[15px]">{RATING_LABELS[gift.rating]}</span>}
      {gift.note && <span className="whitespace-pre-line text-[13px]">{gift.note}</span>}
      {ask && gift.outcome === "delivered" && (
        <Link
          href={`/rounds/${roundId}/reaction?gift=${gift.orderId}`}
          aria-label={gift.rating ? `Change how ${gift.title} went` : `How did it go? ${gift.title}`}
          className="inline-flex min-h-11 items-center self-start text-[13px] font-semibold text-primary"
        >
          {gift.rating ? "Change" : "How did it go?"}
        </Link>
      )}
    </li>
  );
}

/** A person's past rounds, newest first as the module gives them. */
export function PastGifts({
  name,
  rounds,
  today,
  canAnswer,
}: {
  name: string;
  rounds: PastRound[];
  /** The UTC day, as the save counts it. */
  today: CalendarDate;
  /** Whether answers are switched on. */
  canAnswer: boolean;
}) {
  if (rounds.length === 0) {
    return <p className="text-[15px] text-muted-foreground [overflow-wrap:anywhere]">No past gifts for {name} yet.</p>;
  }
  return rounds.map((r) => (
    <section key={r.roundId} aria-labelledby={`round-${r.roundId}`} className="flex flex-col gap-1.5">
      <h2 id={`round-${r.roundId}`} className="text-[17px] font-semibold">
        {`${OCCASION_NAMES[r.occasionKind as keyof typeof OCCASION_NAMES] ?? "Occasion"} · ${fullDate(r.occasionDate)}`}
      </h2>
      {r.gifts.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {r.gifts.map((g) => (
            <GiftItem key={g.orderId} roundId={r.roundId} gift={g} ask={canAnswer && r.occasionDate <= today} />
          ))}
        </ul>
      ) : (
        r.status === "skipped" && <p className="rounded-xl border border-border p-3 text-[15px] text-muted-foreground">No gift was bought.</p>
      )}
    </section>
  ));
}
