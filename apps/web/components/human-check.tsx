"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import { useCallback, useEffect, useState } from "react";
import { FEEDBACK_EMAIL } from "@/lib/brand";

// How long a pass can take before we explain the grey button (ALL-69). Most
// people pass at once, so the note doesn't flash for them.
const SLOW_CHECK_MS = 3000;

// Where to send someone Cloudflare won't pass (ALL-69): Google sign-in skips
// the check; forms without it get our email, shown only once the check fails.
export type WayOut = "google" | "email";

// The bot check on public forms (ALL-68): Cloudflare Turnstile. Most people
// never see it; it shows a box only when Cloudflare wants a click. Inside a
// form it also adds the token as a hidden field (TURNSTILE_FIELD in
// lib/turnstile.ts) for server actions to check.
export function HumanCheck({ onToken, wayOut = "email" }: { onToken: (token: string | null) => void; wayOut?: WayOut }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [state, setState] = useState<"checking" | "slow" | "passed" | "failed">("checking");
  useEffect(() => {
    const timer = setTimeout(() => setState((s) => (s === "checking" ? "slow" : s)), SLOW_CHECK_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!siteKey) {
    return (
      <p role="alert" className="text-[14px] text-destructive">
        The bot check isn&apos;t set up here (NEXT_PUBLIC_TURNSTILE_SITE_KEY), so this form can&apos;t be sent.
      </p>
    );
  }
  const fail = () => {
    setState("failed");
    onToken(null);
  };
  return (
    <>
      <Turnstile
        siteKey={siteKey}
        options={{ appearance: "interaction-only", size: "flexible", theme: "auto" }}
        onSuccess={(token) => {
          setState("passed");
          onToken(token);
        }}
        onExpire={() => onToken(null)}
        onError={fail}
        onUnsupported={fail}
      />
      {state === "slow" && (
        <p aria-live="polite" className="text-[13px] text-muted-foreground">
          Checking you&apos;re not a bot…
        </p>
      )}
      {state === "failed" && (
        <p role="alert" className="text-[14px] text-destructive">
          We couldn&apos;t confirm you&apos;re a person, so this can&apos;t be sent. Refresh the page to try again.{" "}
          {wayOut === "google" ? (
            <>Or use Continue with Google above, which doesn&apos;t need this check.</>
          ) : (
            <>
              Still stuck? Email us at{" "}
              <a href={`mailto:${FEEDBACK_EMAIL}`} className="underline underline-offset-[3px]">
                {FEEDBACK_EMAIL}
              </a>
              .
            </>
          )}
        </p>
      )}
    </>
  );
}

// A token works once, so call reset() after every send to get a new one.
export function useHumanCheck({ wayOut }: { wayOut?: WayOut } = {}) {
  const [token, setToken] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const reset = useCallback(() => {
    setToken(null);
    setRound((r) => r + 1);
  }, []);
  return { token, reset, widget: <HumanCheck key={round} onToken={setToken} wayOut={wayOut} /> };
}
