import Link from "next/link";
import { PickPreview } from "./pick-preview";

export function Hook() {
  return (
    <section className="mx-auto grid w-full max-w-5xl gap-8 px-4 pb-10 pt-4 md:grid-cols-[1.1fr_0.9fr] md:items-center md:px-8 md:py-16">
      <div data-testid="hook-text" className="flex flex-col gap-4">
        <span className="-rotate-3 self-start rounded-full bg-sticker px-3 py-1 text-[13px] font-extrabold text-sticker-foreground">
          Mom&apos;s birthday is Saturday <span aria-hidden="true">👀</span>
        </span>
        <h1 className="text-[34px] font-extrabold leading-[1.05] tracking-tight md:text-[52px]">Gifting, handled AF.</h1>
        <p className="max-w-prose text-[16px] text-muted-foreground md:text-[18px]">
          Where we&apos;re heading: we remember the dates, find the gift, and ship it. You just tap yes.
        </p>
        <div className="flex flex-col gap-3 md:flex-row">
          <Link
            href="/tour"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-6 font-bold text-primary-foreground hover:bg-primary/90"
          >
            Take the tour
          </Link>
          <Link
            href="/request-access"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-secondary px-6 font-bold text-secondary-foreground hover:bg-secondary/70"
          >
            Request access
          </Link>
        </div>
        <Link
          href="/auth/login"
          className="inline-flex min-h-11 items-center self-center text-[14px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground md:self-start"
        >
          Have an invite? Sign in
        </Link>
      </div>
      <div className="hidden md:block">
        <PickPreview />
      </div>
    </section>
  );
}
