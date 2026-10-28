"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "./auth-frame";

export function UpdatePasswordForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    // The reset link already signed the user in.
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setIsLoading(false);
      return;
    }
    router.push("/");
  };

  return (
    <form onSubmit={handleUpdate} className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="password">New password</Label>
        <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <FormError>{error}</FormError>}
      <Button type="submit" className="w-full" disabled={isLoading} aria-busy={isLoading}>
        {isLoading ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
