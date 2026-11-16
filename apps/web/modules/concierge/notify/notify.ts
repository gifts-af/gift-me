import { logEvent } from "@/lib/log";
import type { ActionName } from "./actions";
import type { Channel } from "./channels";
import type { NewLink, NotifyStore } from "./store";
import {
  REPLIES_ARE_NOTES,
  TEMPLATES,
  type NotesReplyKind,
  type NotificationKind,
  type RenderedEmail,
  type TemplateData,
  type TemplateLinks,
} from "./templates";
import { newActionToken } from "./tokens";

// Sends one notification (ALL-23, AC-1, AC-2, AC-13): one-time links in, a
// rendered email out through every channel, one notifications row per send.

export type NotifyDeps = {
  store: NotifyStore;
  channels: Channel[];
  baseUrl: string;
  now: Date;
};

export type NotifyResult = { ok: true } | { ok: false; error: string };

/** A one-time action link, or (`path`) a plain link to a page of the app, with no token. */
export type LinkSpec = { action: ActionName; expiresAt: Date } | { path: string };

export type NotifyInput<K extends NotificationKind> = {
  userId: string;
  roundId?: string;
  /** The person the email is about, saved on the notification row (ALL-31: a reply files to them). */
  personId?: string;
  kind: K;
  data: TemplateData[K];
  links: { [L in keyof TemplateLinks[K]]: LinkSpec };
  /** Only for kinds whose replies are notes; dropped for any other kind (ALL-31 AC-13). */
  replyTo?: K extends NotesReplyKind ? string : never;
  /**
   * Save the Message-ID the email went out with, so a reply's In-Reply-To finds this
   * notification (ALL-31). Read back from the channel: the email service sets the header.
   */
  threadable?: true;
};

const repliesAreNotes = (kind: NotificationKind) => (REPLIES_ARE_NOTES as readonly NotificationKind[]).includes(kind);

export async function notify<K extends NotificationKind>(
  input: NotifyInput<K>,
  deps: NotifyDeps,
): Promise<NotifyResult> {
  const { store, channels, baseUrl, now } = deps;
  const roundId = input.roundId ?? null;
  const personId = input.personId ?? null;
  const replyTo = repliesAreNotes(input.kind) ? (input.replyTo as string | undefined) : undefined;

  const { email } = await store.recipient(input.userId);
  if (!email) return { ok: false, error: "This user has no email address." };

  // One token per link. Only hashes are stored; raw tokens live in the URLs.
  const urls: Record<string, string> = {};
  const links: NewLink[] = [];
  for (const [name, spec] of Object.entries(input.links) as [string, LinkSpec][]) {
    if ("path" in spec) {
      urls[name] = `${baseUrl}${spec.path}`;
      continue;
    }
    const { token, hash } = newActionToken();
    urls[name] = `${baseUrl}/a/${token}`;
    links.push({ hash, userId: input.userId, roundId, action: spec.action, expiresAt: spec.expiresAt });
  }
  await store.insertLinks(links);

  const render = TEMPLATES[input.kind] as (
    data: TemplateData[K],
    links: TemplateLinks[K],
  ) => RenderedEmail;
  const rendered = render(input.data, urls as TemplateLinks[K]);

  const errors: string[] = [];
  let anySent = false;
  for (const [i, channel] of channels.entries()) {
    const id = await store.insertNotification({
      userId: input.userId,
      roundId,
      personId,
      kind: input.kind,
      channel: channel.name,
    });
    if (i === 0) await store.attachLinks(links.map((l) => l.hash), id);

    const result = await channel
      .send({ ...rendered, to: email, replyTo })
      .catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : "Send failed",
      }));

    if (result.ok) {
      anySent = true;
      const messageId = input.threadable && channel.messageId ? await channel.messageId(result.id) : null;
      if (input.threadable && !messageId) logEvent("notify.message_id_missing", { notification_id: id, kind: input.kind });
      await store.finishNotification(id, { sentAt: now, providerMessageId: result.id, messageId });
    } else {
      errors.push(result.error);
      await store.finishNotification(id, { error: result.error });
    }
  }

  if (anySent) return { ok: true };
  return { ok: false, error: errors.join("; ") || "No channels to send through." };
}

/** The settings page's "Send test email": kind `test`, link lifetime from app_settings (T23). */
export async function sendTestNotification(userId: string, deps: NotifyDeps): Promise<NotifyResult> {
  const hours = await deps.store.setting("test_action_link_hours");
  const expiresAt = new Date(deps.now.getTime() + hours * 60 * 60 * 1000);
  return notify(
    { userId, kind: "test", data: {}, links: { tryIt: { action: "test", expiresAt } } },
    deps,
  );
}
