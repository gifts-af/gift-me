// A phone-sized frame in the app's own look, so the tour shows what the real
// screens feel like (ALL-46).
export function Phone({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[375px] flex-col overflow-hidden md:max-w-[400px] rounded-[28px] border bg-card text-card-foreground shadow-sm">
      <p className="border-b px-4 py-3 text-[15px] font-semibold">{title}</p>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </div>
  );
}

export function Row({ children, selected = false }: { children: React.ReactNode; selected?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border p-3 ${selected ? "border-primary ring-1 ring-primary" : ""}`}>
      {children}
    </div>
  );
}
