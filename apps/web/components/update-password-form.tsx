"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { FormError } from "./auth-frame";

export function UpdatePasswordForm() {
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Read on submit, so a password typed or autofilled before the page loaded is kept (ALL-60).
  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    setIsLoading(true);
    setError(null);
    // The reset link already signed the user in.
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }
    // A full page load: the router may hold a signed-out prefetch of Home.
    window.location.assign("/");
  };

  return (
    <form method="post" onSubmit={handleUpdate} className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </div>
      {error && <FormError>{error}</FormError>}
      <Button type="submit" className="w-full" disabled={!hydrated || isLoading} aria-busy={isLoading}>
        {isLoading ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
