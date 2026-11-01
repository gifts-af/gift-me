"use client";

import { useState } from "react";
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
  // when the page comes back with a new list of imported contacts.
  const [round, setRound] = useState(0);
  return (
    <ImportChecklist
      key={`${round}|${imported.join(",")}`}
      action={action}
      imported={imported}
      load={() => loadGoogleContacts(clientId)}
      onAgain={() => setRound((r) => r + 1)}
    />
  );
}
