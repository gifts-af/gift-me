"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EndScreen } from "./end-screen";
import { ClaimScreen, MyListScreen, ShareScreen } from "./list-tour-screens";
import { TourFrame } from "./tour-frame";
import { LIST_TOUR_STEPS } from "./tour-data";

// The list tour (ALL-71): your own wish list, texting the link, a claim, and
// claims kept from you. Client-only; nothing is saved or sent anywhere.
export function ListTour() {
  const [step, setStep] = useState(0);
  const [claimed, setClaimed] = useState<string[]>([]);
  const current = LIST_TOUR_STEPS[step];

  return (
    <TourFrame
      step={step}
      total={LIST_TOUR_STEPS.length}
      caption={current.caption}
      onBack={() => setStep((s) => s - 1)}
      onNext={() => setStep((s) => Math.min(s + 1, LIST_TOUR_STEPS.length - 1))}
    >
      {current.id === "add" && <MyListScreen withNotes />}
      {current.id === "share" && <ShareScreen />}
      {current.id === "claim" && <ClaimScreen claimed={claimed} onClaim={(name) => setClaimed((c) => [...c, name])} />}
      {current.id === "surprise" && <MyListScreen />}
      {current.id === "end" && (
        <EndScreen
          line="Your list is free. Start it now."
          primary={
            <Button asChild>
              <Link href="/auth/sign-up">Start your list, free</Link>
            </Button>
          }
        />
      )}
    </TourFrame>
  );
}
