"use client";

import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Divider, FormError } from "./auth-frame";
import { GoogleButton } from "./google-button";

// Google first, since contacts import needs it; email and password stay for
// people already using the list app (mock-up "signin").
export function LoginForm({ next: rawNext }: { next?: string }) {
  const next = safeNext(rawNext);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const withNext = (path: string) =>
    next === "/" ? path : `${path}?next=${encodeURIComponent(next)}`;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }
    router.push(next);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-7">
      <GoogleButton next={next} />
      <Divider>or</Divider>
      <form onSubmit={handleLogin} className="flex flex-col gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <FormError>{error}</FormError>}
        <Button type="submit" variant="secondary" className="w-full" disabled={isLoading} aria-busy={isLoading}>
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
