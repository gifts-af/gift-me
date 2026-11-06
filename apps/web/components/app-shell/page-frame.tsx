import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// The content column: 16 px gutters on a phone, centred and at most 640 px
// wide on a computer. Only Home and the gift list widen, to 1024 px
// (design/ui.md > Phone and computer).
export function PageFrame({
  wide = false,
  className,
  children,
}: {
  wide?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className={cn(
        "mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-4 sm:px-8 sm:py-6",
        wide ? "max-w-5xl" : "max-w-2xl",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function PageTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h1 id={id} className="text-[22px] font-bold leading-tight [overflow-wrap:anywhere] [text-wrap:balance]">
      {children}
    </h1>
  );
}

// The way back from a page below Get or Give. It lives in the page, so the
// bar is the same everywhere (ALL-95).
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="-ml-1 -mb-4 inline-flex min-h-11 items-center gap-0.5 self-start pr-2 text-[15px]">
      <ChevronLeft className="size-5 flex-none" aria-hidden="true" />
      {label}
    </Link>
  );
}
