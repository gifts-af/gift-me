"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

// Signs out the way the account menu does, then off to sign in again and back
// to `next` (ALL-23, AC-8).
export function SignOutAndReturn({ next }: { next: string }) {
  const [pending, setPending] = useState(false);

  async function switchAccount() {
    setPending(true);
    await createClient().auth.signOut();
    // A full page load, so no signed-in page survives in the router cache.
    window.location.assign(`/auth/login?next=${encodeURIComponent(next)}`);
  }

  return (
    <Button type="button" className="w-full" onClick={switchAccount} disabled={pending} aria-busy={pending}>
      Sign in as someone else
    </Button>
  );
}
