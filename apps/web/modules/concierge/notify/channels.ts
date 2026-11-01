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

export function defaultChannels(): Channel[] {
  return [emailChannel({ apiKey: process.env.RESEND_API_KEY, fetch })];
}
