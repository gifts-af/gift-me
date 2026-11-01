import Link from "next/link";
import { HeroCallout } from "@/components/home/hero-callout";
import { RequestAccessButton } from "@/components/home/request-access-dialog";
import { ListPreview } from "./list-preview";

// The list hero (ALL-71): the part that works today, first. Same layout as
// the concierge hook below it (hook.tsx): text left, sample card right from md.
export function ListHook() {
  return (
    <section aria-labelledby="list-hook-heading" className="mx-auto grid w-full max-w-5xl gap-8 px-4 pb-10 pt-4 md:grid-cols-[1.1fr_0.9fr] md:items-center md:px-8 md:py-16">
      <div data-testid="list-hook-text" className="flex flex-col gap-4">
        <HeroCallout icon="💬" label="Mom" text="What do you want for your birthday?" />
        <h1 id="list-hook-heading" className="text-[34px] font-extrabold leading-[1.05] tracking-tight md:text-[52px]">
          Your wish list, one text away.
        </h1>
        <p className="max-w-prose text-[16px] text-muted-foreground md:text-[18px]">
          Add gifts from any shop. Text one link when someone asks. Family claims a gift so nobody doubles up.
        </p>
        <div className="flex flex-col gap-3 md:flex-row">
          <Link
            href="/tour/list"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-6 font-bold text-primary-foreground hover:bg-primary/90"
          >
            Take the tour
          </Link>
          <RequestAccessButton className="inline-flex min-h-12 items-center justify-center rounded-lg bg-secondary px-6 font-bold text-secondary-foreground hover:bg-secondary/70" />
        </div>
        <Link
          href="/auth/login"
          className="inline-flex min-h-11 items-center self-center text-[14px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground md:self-start"
        >
          Have an invite? Sign in
        </Link>
      </div>
      <div className="hidden md:block">
        <ListPreview />
      </div>
    </section>
  );
}
