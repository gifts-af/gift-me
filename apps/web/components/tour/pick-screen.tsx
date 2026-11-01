import { type TourGift, money } from "./tour-data";
import { Phone } from "./phone";

// Pick one or more gifts; the button shows the total (same rules as the
// ALL-41 mock-up). Used for Mom's list and Dad's ideas.
export function PickScreen({
  title,
  banner,
  gifts,
  picked,
  onToggle,
  onSend,
}: {
  title: string;
  banner: string;
  gifts: TourGift[];
  picked: string[];
  onToggle: (id: string) => void;
  onSend: () => void;
}) {
  const chosen = gifts.filter((g) => picked.includes(g.id));
  const total = chosen.reduce((sum, g) => sum + g.price, 0);
  return (
    <Phone title={title}>
      <p className="rounded-lg bg-accent p-3 text-[14px] text-accent-foreground">{banner}</p>
      {gifts.map((g) => {
        const on = picked.includes(g.id);
        return (
          <button
            key={g.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(g.id)}
            className={`flex items-center gap-3 rounded-lg border p-3 text-left ${on ? "border-primary ring-1 ring-primary" : ""}`}
          >
            <span data-testid="gift-thumb" className="grid size-10 flex-none place-items-center rounded-md bg-muted text-primary" aria-hidden="true">
              <g.icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">{g.name}</span>
              <span className="block text-[13px] text-muted-foreground">{g.note}</span>
            </span>
            <span className="text-[15px] font-semibold tabular-nums">{money(g.price)}</span>
          </button>
        );
      })}
      <button
        type="button"
        disabled={chosen.length === 0}
        onClick={onSend}
        className="min-h-12 rounded-lg bg-primary font-bold text-primary-foreground disabled:opacity-45"
      >
        {chosen.length === 0
          ? "Pick a gift"
          : `Send ${chosen.length} gift${chosen.length > 1 ? "s" : ""} · ${money(total)}`}
      </button>
      <p className="text-[13px] text-muted-foreground">Prices include shipping and tax.</p>
    </Phone>
  );
}
