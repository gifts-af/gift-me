import { ChevronRight } from "lucide-react";
import Link from "next/link";

/** One row of the Settings list (ALL-115): label left, value muted right, chevron. */
export function SettingsRow({ href, label, value }: { href: string; label: string; value: string }) {
  return (
    <Link href={href} className="flex min-h-11 items-center justify-between gap-3 px-4">
      <span className="text-[15px]">{label}</span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate text-[15px] text-muted-foreground">{value}</span>
        <ChevronRight className="size-5 flex-none text-muted-foreground" aria-hidden="true" />
      </span>
    </Link>
  );
}
