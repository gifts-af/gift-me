// The "pick a gift" moment, shown beside the hook on computers: what the
// concierge will feel like. Made-up gifts from the mock-ups (ALL-41).
const gifts = [
  { name: "Stoneware mug set", note: "From her list · arrives Thu", price: "$42" },
  { name: "Herb planter", note: "From her list · arrives Fri", price: "$68" },
];

export function PickPreview() {
  return (
    <div data-testid="pick-preview" aria-hidden="true" className="grid gap-3 rounded-2xl border bg-card p-4 text-card-foreground shadow-sm">
      <p className="text-[15px] font-semibold">Mom&apos;s birthday · Sat</p>
      {gifts.map((gift, i) => (
        <div
          key={gift.name}
          className={`flex items-center gap-3 rounded-lg border p-3 ${i === 0 ? "border-primary ring-1 ring-primary" : ""}`}
        >
          <span className="size-10 flex-none rounded-md bg-muted" />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">{gift.name}</span>
            <span className="block text-[12px] text-muted-foreground">{gift.note}</span>
          </span>
          <span className="text-[14px] font-semibold tabular-nums">{gift.price}</span>
        </div>
      ))}
      <span className="rounded-lg bg-primary py-2.5 text-center text-[14px] font-bold text-primary-foreground">
        Send it · $42
      </span>
    </div>
  );
}
