"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import { useCallback, useState } from "react";

// The bot check on public forms (ALL-68): Cloudflare Turnstile. Most people
// never see it; it shows a box only when Cloudflare wants a click. Inside a
// form it also adds the token as a hidden field (TURNSTILE_FIELD in
// lib/turnstile.ts) for server actions to check.
export function HumanCheck({ onToken }: { onToken: (token: string | null) => void }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) {
    return (
      <p role="alert" className="text-[14px] text-destructive">
        The bot check isn&apos;t set up here (NEXT_PUBLIC_TURNSTILE_SITE_KEY), so this form can&apos;t be sent.
      </p>
    );
  }
  return (
    <Turnstile
      siteKey={siteKey}
      options={{ appearance: "interaction-only", size: "flexible", theme: "auto" }}
      onSuccess={onToken}
      onExpire={() => onToken(null)}
      onError={() => onToken(null)}
    />
  );
}

// A token works once, so call reset() after every send to get a new one.
export function useHumanCheck() {
  const [token, setToken] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const reset = useCallback(() => {
    setToken(null);
    setRound((r) => r + 1);
  }, []);
  return { token, reset, widget: <HumanCheck key={round} onToken={setToken} /> };
}
