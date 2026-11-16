import { logEvent } from "@/lib/log";
import { sendEmail } from "@/lib/resend";
import type { RenderedEmail } from "./templates";

// Where a notification goes (AC-13). Email is the only channel today; SMS or
// push later is one more entry in defaultChannels().

export type ChannelResult = { ok: true; id: string } | { ok: false; error: string };

export interface Channel {
  name: string;
  send(email: RenderedEmail & { to: string; replyTo?: string }): Promise<ChannelResult>;
}

export function emailChannel(deps: { apiKey: string | undefined; fetch: typeof fetch }): Channel {
  return { name: "email", send: (email) => sendEmail(email, deps) };
}

// EMAIL_OUTBOX=log swaps Resend for a logged event, so local and e2e runs need no
// key. Never in production, whatever the variable says (ALL-28).
function outboxChannel(): Channel {
  return {
    name: "email",
    async send() {
      // The channel doesn't know the notification kind, so only the shape is logged.
      logEvent("email_outbox", { to_user: false, subject_kind: null });
      return { ok: true, id: `outbox-${crypto.randomUUID()}` };
    },
  };
}

export function defaultChannels(env: Record<string, string | undefined> = process.env): Channel[] {
  if (env.EMAIL_OUTBOX === "log" && env.VERCEL_ENV !== "production") return [outboxChannel()];
  return [emailChannel({ apiKey: env.RESEND_API_KEY, fetch })];
}
