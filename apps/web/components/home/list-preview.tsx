import { MY_LIST } from "@/components/tour/tour-data";

// The list as the person who asked sees it (ALL-71): the text, then the shared
// list with one gift already claimed. The owner never sees claims (decision
// 39), so this is the asker's view. Sample content, not real data.
export function ListPreview() {
  return (
    <div data-testid="list-preview" aria-hidden="true" className="grid gap-3 rounded-2xl border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex flex-col gap-1.5 text-[14px]">
        <span className="max-w-[80%] self-start rounded-2xl bg-muted px-3 py-1.5">what do u want for ur bday?</span>
        <span className="max-w-[80%] self-end rounded-2xl bg-primary px-3 py-1.5 text-primary-foreground">here you go 👇</span>
      </div>
      <p className="text-[15px] font-semibold">Aaron&apos;s list</p>
      {MY_LIST.map((gift, i) => (
        <div key={gift.name} className="flex items-center gap-3 rounded-lg border p-3">
          <span data-testid="gift-thumb" className="grid size-10 flex-none place-items-center rounded-md bg-muted text-primary" aria-hidden="true">
            <gift.icon className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">{gift.name}</span>
            <span className="block text-[12px] tabular-nums text-muted-foreground">{gift.price}</span>
          </span>
          {i === 0 ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[12px] font-semibold text-muted-foreground">Claimed</span>
          ) : (
            <span className="rounded-lg bg-primary px-3 py-1 text-[13px] font-bold text-primary-foreground">Claim</span>
          )}
        </div>
      ))}
    </div>
  );
}
