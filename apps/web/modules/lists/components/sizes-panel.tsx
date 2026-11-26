import { SIZE_KINDS, type SharedSize } from "@/lib/size-kinds";
import { relevantSizes } from "@/modules/lists/lib/relevant-sizes";

const LABELS: Record<string, string> = Object.fromEntries(SIZE_KINDS.map((size) => [size.kind, size.label]));

/**
 * What the list's owner shares that fits this gift, for someone about to buy it. Renders nothing
 * for no sizes, so a box without them looks exactly as it did.
 */
export default function SizesPanel({
  sizes,
  name,
  giftName,
}: {
  sizes: SharedSize[] | null;
  name: string | null;
  giftName: string;
}) {
  const fitting = sizes && sizes.length > 0 ? relevantSizes(giftName, sizes) : [];
  if (fitting.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted px-3 py-2">
      <p className="text-[13px] font-semibold">{name ? `${name}'s sizes` : "Their sizes"}</p>
      <p className="text-[15px] [overflow-wrap:anywhere]">
        {fitting.map((size) => `${LABELS[size.kind]}: ${size.value}`).join(" · ")}
      </p>
    </div>
  );
}
