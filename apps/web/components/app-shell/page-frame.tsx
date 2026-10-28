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
