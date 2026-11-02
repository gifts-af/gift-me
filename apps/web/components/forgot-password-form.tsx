"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { useHumanCheck } from "./human-check";
import { FormError } from "./auth-frame";

export function ForgotPasswordForm() {
  const hydrated = useHydrated();
  const human = useHumanCheck();
  // Kept for the "on its way to …" message after sending.
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Read on submit, so an email typed or autofilled before the page loaded is kept (ALL-60).
  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    setEmail(email);
    setIsLoading(true);
    setError(null);
    // This URL must be in Supabase > Authentication > URL Configuration > Redirect URLs.
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
      captchaToken: human.token ?? undefined,
    });
    setIsLoading(false);
    human.reset();
    if (error) setError(error.message);
    else setSuccess(true);
  };

  if (success) {
    return (
      <p className="rounded-lg bg-accent p-3 text-sm text-accent-foreground" role="status">
        If you signed up with an email and password, a reset link is on its way to {email}.
      </p>
    );
  }

  return (
    <form method="post" onSubmit={handleForgotPassword} className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {human.widget}
      {error && <FormError>{error}</FormError>}
      <Button type="submit" className="w-full" disabled={!hydrated || isLoading || !human.token} aria-busy={isLoading}>
        {isLoading ? "Sending…" : "Send reset link"}
      </Button>
      <Button asChild variant="link" size="sm" className="self-center">
        <Link href="/auth/login">Back to sign in</Link>
      </Button>
    </form>
  );
}
