import { ChevronRight } from "lucide-react";
import Link from "next/link";

// You, first among your people on Give (ALL-95): the way to your own list.
// `count` is undefined while loading and null if it couldn't be read, which
// must never read as "you have no list".
export function YouCard({ count }: { count?: number | null }) {
  return (
    <Link
      href="/lists"
      className="flex min-h-11 items-center gap-3 rounded-lg border border-sticker bg-sticker/10 p-3 hover:bg-sticker/20"
    >
      <span
        aria-hidden="true"
        className="grid size-14 flex-none place-items-center rounded-full bg-sticker text-[15px] font-semibold text-sticker-foreground"
      >
        You
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">You</span>
        {count !== undefined && <span className="mt-0.5 block text-[13px] text-muted-foreground">{line(count)}</span>}
      </span>
      <ChevronRight className="size-5 flex-none text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function line(count: number | null): string {
  if (count === null) return "Your list";
  if (count === 0) return "Treat yourself · Start your wish list";
  return `Treat yourself · ${count === 1 ? "1 gift" : `${count} gifts`} on your list`;
}
