// The small card above each hero's headline (ALL-73): a phone notification,
// so the line reads as the moment it is (a text from Mom, a reminder). It
// replaced a tilted yellow sticker that was too loud; yellow is now only on
// the icon tile. Follows light and dark through the card tokens.
export function HeroCallout({ icon, label, text }: { icon: string; label: string; text: React.ReactNode }) {
  return (
    <p
      data-testid="hero-callout"
      className="flex max-w-[22rem] items-center gap-2.5 self-start rounded-[14px] border bg-card py-2 pl-2 pr-3 text-card-foreground shadow-sm"
    >
      <span aria-hidden="true" className="grid size-7 flex-none place-items-center rounded-[7px] bg-sticker text-[15px]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="block text-[14px] font-medium">{text}</span>
      </span>
    </p>
  );
}
