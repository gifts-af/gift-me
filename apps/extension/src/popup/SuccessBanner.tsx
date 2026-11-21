// The green "✓ Saved to Jimmy" / "✓ Added to your list" banner that starts
// every result screen (ALL-78 mock-ups).
export function SuccessBanner({ title, detail }: { title: string; detail?: string }) {
  return (
    <div role="status" className="banner">
      <span className="tick" aria-hidden="true">
        ✓
      </span>
      <div className="min-w-0">
        <b className="block text-base">{title}</b>
        {detail && <small className="block text-[13px] text-foreground/80 [overflow-wrap:anywhere]">{detail}</small>}
      </div>
    </div>
  );
}
