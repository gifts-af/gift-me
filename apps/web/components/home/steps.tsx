// "How it'll work": a numbered circle, then a title over one line, so a step
// never wraps mid-sentence (owner, ALL-46).
const steps = [
  { title: "Add your people", text: "Import from Google or add them by hand." },
  { title: "We get ideas ready", text: "From their lists and what you've saved." },
  { title: "You tap yes", text: "We order it and it shows up on time." },
];

export function Steps() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-4 border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-10 md:px-8">
        <h2 id="how-heading" className="text-[12px] font-extrabold uppercase tracking-wider text-primary">
          How it&apos;ll work
        </h2>
        <ol className="grid gap-4 md:grid-cols-3">
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
