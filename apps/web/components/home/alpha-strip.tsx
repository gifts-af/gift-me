// Every home and tour page says up front that this is early alpha (ALL-46).
export function AlphaStrip() {
  return (
    <p className="bg-sticker px-4 py-2 text-[13px] font-bold text-sticker-foreground md:px-8">
      <span aria-hidden="true">🚧 </span>Early alpha. Lots is broken. Poke around anyway.
    </p>
  );
}
