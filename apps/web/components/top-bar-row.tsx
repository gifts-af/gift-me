import { cn } from "@/lib/utils";

// The one row every top bar uses (ALL-54): same width, side padding and
// height everywhere, so the logo sits in exactly the same spot on the home
// page, the tour and every app screen. Page content below can be narrower.
export function TopBarRow({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      data-top-bar-row=""
      className={cn("mx-auto flex min-h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 md:px-8", className)}
    >
      {children}
    </div>
  );
}
