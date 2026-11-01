"use client";

import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { useHumanCheck } from "./human-check";
import { Divider, FormError } from "./auth-frame";
import { GoogleButton } from "./google-button";

export function SignUpForm({ next: rawNext }: { next?: string }) {
  const next = safeNext(rawNext);
  const hydrated = useHydrated();
  const human = useHumanCheck();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  // Fields are read on submit, so anything typed or autofilled before the
  // page loaded is kept (ALL-60).
  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "");
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const repeatPassword = String(form.get("repeat-password"));
    setError(null);
    if (password !== repeatPassword) {
      setError("The passwords don't match.");
      return;
    }
    setIsLoading(true);
    // Optional; claim_gift falls back to the email when it's missing.
    const displayName = name.trim();
    const { error } = await createClient().auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${next}`,
        data: displayName ? { display_name: displayName } : undefined,
        captchaToken: human.token ?? undefined,
      },
    });
    if (error) {
      human.reset();
      setError(error.message);
      setIsLoading(false);
      return;
    }
    router.push("/auth/sign-up-success");
  };

  return (
    <div className="flex flex-col gap-7">
      <GoogleButton next={next} />
      <Divider>or</Divider>
      <form method="post" onSubmit={handleSignUp} className="flex flex-col gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="name">
            Name <span className="font-normal text-muted-foreground">Optional</span>
          </Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            maxLength={80}
            aria-describedby="name-hint"
          />
          <p id="name-hint" className="text-[13px] text-muted-foreground">
            Shown to others when you claim a gift. Leave it blank to show your email instead.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="repeat-password">Repeat password</Label>
          <Input
            id="repeat-password"
            name="repeat-password"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>
        {human.widget}
        {error && <FormError>{error}</FormError>}
        <Button type="submit" variant="secondary" className="w-full" disabled={!hydrated || isLoading || !human.token} aria-busy={isLoading}>
          {isLoading ? "Creating your account…" : "Create account"}
        </Button>
      </form>
      <p className="text-center text-[15px] text-muted-foreground">
        Already have an account?{" "}
        <Link href={next === "/" ? "/auth/login" : `/auth/login?next=${encodeURIComponent(next)}`} className="text-foreground underline underline-offset-[3px]">
          Sign in
        </Link>
      </p>
    </div>
  );
}
