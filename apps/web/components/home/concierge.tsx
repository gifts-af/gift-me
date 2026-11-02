// The concierge story (ALL-56): the AI does the remembering and recommending
// for you. It learns each person from your feedback and theirs, keeps a
// profile that grows, picks ideas that fit, and tells you when it's time.
// Still being built, and the label says so.

const facts = [
  { fact: "Loves strong coffee", source: "You told us" },
  { fact: "Woodworks in an unheated garage", source: "You told us" },
  { fact: "Shirt L · shoe 10.5", source: "His list" },
  { fact: "Loved last year's knife roll", source: "His reaction" },
  { fact: "Avoid gadgets that need an app", source: "His reaction" },
];

export function Concierge() {
  return (
    <section id="concierge" aria-labelledby="concierge-heading" className="border-t">
      <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-10 md:grid-cols-2 md:items-center md:px-8 md:py-16">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-extrabold uppercase tracking-wider text-primary">The concierge</span>
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[12px] font-extrabold text-warning">Being built</span>
          </div>
          <h2 id="concierge-heading" className="text-[28px] font-extrabold leading-[1.1] tracking-tight md:text-[40px]">
            It gets to know your people, so you don&apos;t have to.
          </h2>
          <p className="text-[17px]">
            It learns from your feedback and from how they liked each gift, and keeps a profile of everyone you buy
            for: what they love, their sizes, what to skip, what landed. It gets sharper every year.
          </p>
          <p className="text-[17px]">
            From that, it picks a short list of ideas that fit them and your budget. No searching. It tells you when
            it&apos;s time to buy, early enough to arrive on time, and one tap buys it and ships it.
          </p>
        </div>

        {/* Sample content: an illustration of a profile, not real data or prices. */}
        <figure
          aria-label="What it knows about Dad"
          className="m-0 flex flex-col gap-4 rounded-2xl border bg-card p-5 text-card-foreground shadow-sm"
        >
          <figcaption className="flex items-center gap-3">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-accent text-[16px] font-extrabold text-accent-foreground">
              D
            </span>
            <span>
              <span className="block text-[17px] font-bold">What it knows about Dad</span>
              <span className="block text-[14px] text-muted-foreground">Birthday · Apr 10</span>
            </span>
          </figcaption>
          <ul className="flex flex-col divide-y">
            {facts.map((f) => (
              <li key={f.fact} className="flex items-center justify-between gap-3 py-2.5 text-[15px]">
                <span>{f.fact}</span>
                <span className="flex-none rounded-full bg-muted px-2 py-0.5 text-[12px] font-semibold text-muted-foreground">
                  {f.source}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent p-3 text-accent-foreground">
            <span className="text-[15px] font-semibold">3 ideas ready, two weeks before his birthday</span>
            <span className="rounded-lg bg-primary px-3 py-1.5 text-[14px] font-bold text-primary-foreground">Send it · $46</span>
          </div>
        </figure>
      </div>
    </section>
  );
}
