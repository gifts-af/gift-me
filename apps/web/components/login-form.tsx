"use client";

import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { Divider, FormError } from "./auth-frame";
import { GoogleButton } from "./google-button";

// Google first, since contacts import needs it; email and password stay for
// people already using the list app (mock-up "signin").
export function LoginForm({ next: rawNext }: { next?: string }) {
  const next = safeNext(rawNext);
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const withNext = (path: string) =>
    next === "/" ? path : `${path}?next=${encodeURIComponent(next)}`;

  // Fields are read on submit, not tracked as you type, so anything typed or
  // autofilled before the page loaded is kept (ALL-60).
  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setIsLoading(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }
    // A full page load, not router.push: the router may hold a prefetch of
    // `next` made while signed out (a redirect back here), and would replay it.
    window.location.assign(next);
  };

  return (
    <div className="flex flex-col gap-7">
      <GoogleButton next={next} />
      <Divider>or</Divider>
      <form method="post" onSubmit={handleLogin} className="flex flex-col gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        {error && <FormError>{error}</FormError>}
        <Button type="submit" variant="secondary" className="w-full" disabled={!hydrated || isLoading} aria-busy={isLoading}>
          {isLoading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="flex justify-between">
        <Button asChild variant="link" size="sm" className="px-1">
          <Link href="/auth/forgot-password">Forgot password?</Link>
        </Button>
        <Button asChild variant="link" size="sm" className="px-1">
          <Link href={withNext("/auth/sign-up")}>Create an account</Link>
        </Button>
      </div>
    </div>
  );
}
