export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      <div className="divide-y divide-border rounded-xl border border-border">{children}</div>
    </section>
  );
}
