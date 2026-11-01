"use client";

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
  return <ImportChecklist action={action} imported={imported} load={() => loadGoogleContacts(clientId)} />;
}
