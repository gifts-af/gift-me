"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

// Vercel Web Analytics: cookieless page-view counts. Share links and person or round
// pages carry tokens and ids in their path, so those become placeholders. Of the query
// string only utm_* tags are kept (they say which link brought a visitor); the rest, such as
// sign-in codes and return paths, and the fragment are dropped before anything is sent.
const ID_AFTER = new Set(["a", "share", "people", "rounds", "fix"]);

export function redactPath(url: string): string {
  const u = new URL(url);
  const segs = u.pathname.split("/");
  for (let i = 1; i < segs.length; i++) if (ID_AFTER.has(segs[i - 1]) && segs[i]) segs[i] = "[id]";
  const utm = new URLSearchParams();
  u.searchParams.forEach((value, key) => {
    if (key.startsWith("utm_")) utm.append(key, value);
  });
  const tags = utm.toString();
  const query = tags ? `?${tags}` : "";
  return `${u.origin}${segs.join("/")}${query}`;
}

function beforeSend(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: redactPath(event.url) };
}

export function WebAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
