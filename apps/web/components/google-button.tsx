"use client";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { FormError } from "./auth-frame";

// Leaves for Google, which returns to /auth/callback and then to `next`.
// `loginHint` is an email Google pre-selects, skipping its account chooser
// when that account is already in the browser (ALL-23, AC-7).
export function GoogleButton({ next = "/", loginHint }: { next?: string; loginHint?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        ...(loginHint && { queryParams: { login_hint: loginHint } }),
      },
    });
    // On success the browser is already on its way to Google.
    if (error) {
      setError(error.message);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" className="w-full" onClick={signIn} disabled={pending} aria-busy={pending}>
        {pending ? "Opening Google…" : "Continue with Google"}
      </Button>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
