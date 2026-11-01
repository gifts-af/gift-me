"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { HomeTopBar } from "@/components/home/home-top-bar";
import { DoneScreen } from "./done-screen";
import { EndScreen } from "./end-screen";
import { ListScreen } from "./list-screen";
import { PeopleScreen } from "./people-screen";
import { PickScreen } from "./pick-screen";
import { ShipScreen } from "./ship-screen";
import { DAD_IDEAS, MOM_GIFTS, TOUR_STEPS } from "./tour-data";

// The guided tour (ALL-46): the app's screens with made-up people. Client-only;
// nothing is saved, bought or sent anywhere.
export function Tour() {
  const [step, setStep] = useState(0);
  const [momPicks, setMomPicks] = useState<string[]>([]);
  const [dadPicks, setDadPicks] = useState<string[]>([]);
  const current = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;

  // Each new step's caption takes focus, so keyboard and screen-reader users
  // aren't dropped when a button they pressed disappears (the last step has
  // no Next). Skipped on first render, so the page doesn't jump on load.
  const caption = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    caption.current?.focus();
  }, [step]);
  const advance = () => setStep((s) => Math.min(s + 1, TOUR_STEPS.length - 1));

  const toggle =(set: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) =>
    set((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <div className="min-h-svh bg-background text-foreground">
      <HomeTopBar />
      {/* Phone: one column (step, caption, screen, buttons). From md, two
          columns like the home page's hook: step, caption and buttons left, the
          phone right (ALL-61). Placed with the grid, so the reading and tab order
          stays step, caption, screen, buttons on every screen. */}
      <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 pb-12 pt-4 md:grid md:max-w-5xl md:grid-cols-[minmax(0,1fr)_minmax(0,400px)] md:grid-rows-[auto_auto_auto_1fr] md:content-start md:gap-x-12 md:gap-y-6 md:px-8 md:py-16">
        <div className="flex items-center justify-between gap-3 md:col-start-1 md:row-start-1">
          <p className="text-[13px] font-semibold text-muted-foreground">
            Step {step + 1} of {TOUR_STEPS.length}
          </p>
          <Link href="/" className="inline-flex min-h-11 items-center text-[14px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground">
            Skip tour
          </Link>
        </div>
        <h1 ref={caption} tabIndex={-1} className="text-[22px] font-extrabold leading-tight tracking-tight outline-none md:col-start-1 md:row-start-2 md:text-[36px] md:leading-[1.1]">
          {current.caption}
        </h1>

        <div data-testid="tour-screen" className="md:col-start-2 md:row-span-4 md:row-start-1">
          {current.id === "people" && <PeopleScreen />}
          {current.id === "pick" && (
            <PickScreen
              title="Mom's birthday · Sat, Mar 14"
              banner="From Mom's own list. She chose these herself."
              gifts={MOM_GIFTS}
              picked={momPicks}
              onToggle={toggle(setMomPicks)}
              onSend={advance}
            />
          )}
          {current.id === "ship" && <ShipScreen />}
          {current.id === "done" && <DoneScreen />}
          {current.id === "ideas" && (
            <PickScreen
              title="Dad's birthday · Fri, Apr 10"
              banner="Suggested from 4 things you saved about Dad."
              gifts={DAD_IDEAS}
              picked={dadPicks}
              onToggle={toggle(setDadPicks)}
              onSend={advance}
            />
          )}
          {current.id === "list" && <ListScreen />}
          {current.id === "end" && <EndScreen />}
        </div>

        {!last && (
          <div className="flex gap-3 md:col-start-1 md:row-start-3 md:self-start">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="min-h-12 flex-1 rounded-lg bg-secondary font-bold text-secondary-foreground hover:bg-secondary/70"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={advance}
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
