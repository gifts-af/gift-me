"use client";

import { useEffect, useState } from "react";
import type { ImportResult } from "@/modules/concierge";
import { loadGoogleContacts } from "./google-contacts";
import { ImportChecklist } from "./import-checklist";

// Binds the checklist to Google (ALL-24). Kept apart so the checklist's tests
// can hand it fake contacts instead.
export function ImportFromGoogle({
  clientId,
  imported,
  action,
}: {
  clientId: string;
  imported: string[];
  action: (previous: ImportResult | null, formData: FormData) => Promise<ImportResult>;
}) {
  // A fresh checklist for each round (ALL-72): after "Import more people", and
  // whenever you leave the page and come back. Next.js keeps a page you leave
  // in a hidden <Activity>, which runs effect cleanups, so the cleanup below
  // starts a new round for your return. The import's own page refresh doesn't
  // hide the page, so its result stays on screen.
  const [round, setRound] = useState(0);
  useEffect(() => () => setRound((r) => r + 1), []);
  return (
    <ImportChecklist
      key={round}
      action={action}
      imported={imported}
      load={() => loadGoogleContacts(clientId)}
      onAgain={() => setRound((r) => r + 1)}
    />
  );
}
