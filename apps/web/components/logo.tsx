import { APP_NAME } from "@/lib/brand";
import { AF, AF_ON_TAG, HAT, HAT_ON_TAG, TAG_TILT, TAG_WITH_HEART } from "@/lib/logo-art";
import { cn } from "@/lib/utils";

// The GiftsAF wordmark (ALL-48): "Gifts" in heavy type, then "AF" on the
// tilted yellow tag. It sizes with the surrounding font. The Santa hat is
// always drawn but only shows while the root layout marks <html
// data-holiday> (lib/holiday.ts), so client components get it too.
export function Logo({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label={APP_NAME}
      className={cn("inline-flex items-center gap-[0.1em] font-black tracking-tight", className)}
    >
      <span aria-hidden="true">Gifts</span>
      <svg
        aria-hidden="true"
        viewBox="-4 -6 84 52"
        overflow="visible"
        className="h-[1.2em] w-[1.94em]"
      >
        <g transform={`rotate(${TAG_TILT} 38 20)`}>
          <path data-part="tag" d={TAG_WITH_HEART} fillRule="evenodd" className="fill-sticker" />
          <path data-part="af" d={AF} transform={AF_ON_TAG} fillRule="evenodd" className="fill-sticker-foreground" />
          <g data-part="hat" transform={HAT_ON_TAG} className="hidden [html[data-holiday]_&]:inline">
            <path d={HAT.crown} fill={HAT.red} />
            <rect {...HAT.brim} fill={HAT.white} stroke={HAT.edge} />
            <circle {...HAT.bobble} fill={HAT.white} stroke={HAT.edge} />
          </g>
        </g>
      </svg>
    </span>
  );
}
