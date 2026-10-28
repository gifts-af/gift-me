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

export function SignUpForm({ next: rawNext }: { next?: string }) {
  const next = safeNext(rawNext);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
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
      },
    });
    if (error) {
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
      <form onSubmit={handleSignUp} className="flex flex-col gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="name">
            Name <span className="font-normal text-muted-foreground">Optional</span>
          </Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            maxLength={80}
            aria-describedby="name-hint"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p id="name-hint" className="text-[13px] text-muted-foreground">
            Shown to others when you claim a gift. Leave it blank to show your email instead.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="repeat-password">Repeat password</Label>
          <Input
            id="repeat-password"
            type="password"
            autoComplete="new-password"
            required
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
          />
        </div>
        {error && <FormError>{error}</FormError>}
        <Button type="submit" variant="secondary" className="w-full" disabled={isLoading} aria-busy={isLoading}>
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
