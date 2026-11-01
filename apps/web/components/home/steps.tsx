// "How it'll work": a numbered circle, then a title over one line, so a step
// never wraps mid-sentence (owner, ALL-46). The steps are the concierge loop
// (ALL-56): it learns your people, then tells you when.
const steps = [
  { title: "Tell us who you buy for", text: "Import from Google or add them by hand." },
  { title: "It learns them", text: "From your notes, their list, and how they liked past gifts." },
  { title: "It tells you when", text: "Ideas that fit, early enough to arrive on time." },
  { title: "You tap yes", text: "We buy it and ship it." },
];

export function Steps() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-4 border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-10 md:px-8">
        <h2 id="how-heading" className="text-[12px] font-extrabold uppercase tracking-wider text-primary">
          How it&apos;ll work
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <li key={step.title} className="flex items-start gap-3">
              <span className="grid size-7 flex-none place-items-center rounded-full bg-primary text-[13px] font-extrabold text-primary-foreground">
                {i + 1}
              </span>
              <span>
                <span className="block text-[16px] font-bold">{step.title}</span>
                <span className="block text-[15px] text-muted-foreground">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="text-[14px] text-muted-foreground">Nothing is ever bought without your OK.</p>
      </div>
    </section>
  );
}
