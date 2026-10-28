"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useState } from "react";
import { FormError } from "./auth-frame";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    // This URL must be in Supabase > Authentication > URL Configuration > Redirect URLs.
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    });
    setIsLoading(false);
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
    <form onSubmit={handleForgotPassword} className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <FormError>{error}</FormError>}
      <Button type="submit" className="w-full" disabled={isLoading} aria-busy={isLoading}>
        {isLoading ? "Sending…" : "Send reset link"}
      </Button>
      <Button asChild variant="link" size="sm" className="self-center">
        <Link href="/auth/login">Back to sign in</Link>
      </Button>
    </form>
  );
}
