// What works today, honestly labelled (ALL-46).
const features = [
  {
    status: "Works now",
    tone: "bg-success-soft text-success",
    title: "Your gift list",
    text: "Make a list, share one link. Family claims a gift and nobody doubles up.",
  },
  {
    status: "Being built",
    tone: "bg-warning-soft text-warning",
    title: "Never forget a birthday",
    text: "Dates remembered, ideas a week early, one tap to send. In testing with a few friends.",
  },
  {
    status: "Later",
    tone: "bg-muted text-foreground",
    title: "Buy-me-a-drink shirts",
    text: "Wear a QR code. Strangers buy you a drink.",
  },
];

export function Features() {
  return (
    <section aria-labelledby="today-heading" className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-10 md:px-8">
        <h2 id="today-heading" className="text-[12px] font-extrabold uppercase tracking-wider text-primary">
          What works today
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {features.map((f) => (
            <article key={f.title} className="flex flex-col gap-2 rounded-2xl border bg-card p-4 text-card-foreground">
              <span className={`self-start rounded-full px-2 py-0.5 text-[12px] font-extrabold ${f.tone}`}>{f.status}</span>
              <h3 className="text-[17px] font-bold">{f.title}</h3>
              <p className="text-[15px] text-muted-foreground">{f.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
