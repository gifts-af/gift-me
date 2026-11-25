"use client";

import Link from "next/link";
import { useState } from "react";
import { RequestAccessButton } from "@/components/home/request-access-dialog";
import { DoneScreen } from "./done-screen";
import { END_LINK, EndScreen } from "./end-screen";
import { ListScreen } from "./list-screen";
import { PeopleScreen } from "./people-screen";
import { PickScreen } from "./pick-screen";
import { ShipScreen } from "./ship-screen";
import { TourFrame } from "./tour-frame";
import { DAD_IDEAS, MOM_GIFTS, TOUR_STEPS } from "./tour-data";

// The guided tour (ALL-46): the app's screens with made-up people. Client-only;
// nothing is saved, bought or sent anywhere.
export function Tour() {
  const [step, setStep] = useState(0);
  const [momPicks, setMomPicks] = useState<string[]>([]);
  const [dadPicks, setDadPicks] = useState<string[]>([]);
  const current = TOUR_STEPS[step];
  const advance = () => setStep((s) => Math.min(s + 1, TOUR_STEPS.length - 1));

  const toggle = (set: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) =>
    set((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <TourFrame step={step} total={TOUR_STEPS.length} caption={current.caption} onBack={() => setStep((s) => s - 1)} onNext={advance}>
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
      {current.id === "end" && (
        <EndScreen
          line="We're letting people into the concierge a few at a time. Your list and your people are free."
          primary={<RequestAccessButton variant="default" />}
          secondary={
            <Link href="/auth/sign-up" className={END_LINK}>
              Just want the list? Start it, free
            </Link>
          }
        />
      )}
    </TourFrame>
  );
}
