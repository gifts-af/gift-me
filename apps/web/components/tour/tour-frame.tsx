"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { HomeTopBar } from "@/components/home/home-top-bar";

// The frame both tours share (ALL-46, ALL-71): step counter, Skip tour, the
// caption, the phone screen and Back/Next. Phone: one column (step, caption,
// screen, buttons). From md, two columns like the home page's hook: step,
// caption and buttons left, the phone right (ALL-61). Placed with the grid, so
// the reading and tab order stays step, caption, screen, buttons.
export function TourFrame({
  step,
  total,
  caption,
  onBack,
  onNext,
  children,
}: {
  step: number;
  total: number;
  caption: string;
  onBack: () => void;
  onNext: () => void;
  children: React.ReactNode;
}) {
  const last = step === total - 1;

  // Each new step's caption takes focus, so keyboard and screen-reader users
  // aren't dropped when a button they pressed disappears (the last step has
  // no Next). Skipped on first render, so the page doesn't jump on load.
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <HomeTopBar />
      <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 pb-12 pt-4 md:grid md:max-w-5xl md:grid-cols-[minmax(0,1fr)_minmax(0,400px)] md:grid-rows-[auto_auto_auto_1fr] md:content-start md:gap-x-12 md:gap-y-6 md:px-8 md:py-16">
        <div className="flex items-center justify-between gap-3 md:col-start-1 md:row-start-1">
          <p className="text-[13px] font-semibold text-muted-foreground">
            Step {step + 1} of {total}
          </p>
          <Link href="/" className="inline-flex min-h-11 items-center text-[14px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground">
            Skip tour
          </Link>
        </div>
        <h1 ref={heading} tabIndex={-1} className="text-[22px] font-extrabold leading-tight tracking-tight outline-none md:col-start-1 md:row-start-2 md:text-[36px] md:leading-[1.1]">
          {caption}
        </h1>

        <div data-testid="tour-screen" className="md:col-start-2 md:row-span-4 md:row-start-1">
          {children}
        </div>

        {!last && (
          <div className="flex gap-3 md:col-start-1 md:row-start-3 md:self-start">
            {step > 0 && (
              <button
                type="button"
                onClick={onBack}
                className="min-h-12 flex-1 rounded-lg bg-secondary font-bold text-secondary-foreground hover:bg-secondary/70"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={onNext}
              className="min-h-12 flex-[2] rounded-lg bg-primary font-bold text-primary-foreground hover:bg-primary/90"
            >
              Next
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
