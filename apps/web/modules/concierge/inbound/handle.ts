import { randomUUID } from "node:crypto";
import type { Extract } from "@/lib/ai/extract";
import { errorFields, logEvent } from "@/lib/log";
import { fetchMessageId } from "@/lib/resend";
import { fetchAttachment, fetchReceivedEmail, type Deps as ResendDeps, type ReceivedEmail } from "@/lib/resend-inbound";
import { IMAGE_EXTENSIONS, saveNoteCapture } from "../capture/capture";
import { processCapture } from "../capture/extract";
import type { CaptureStore } from "../capture/store";
import type { RecordCost } from "../costs/record";
import type { LinkSpec, NotifyDeps, NotifyInput } from "../notify/notify";
import type { NotificationKind } from "../notify/templates";
import {
  firstImage,
  isAutoReply,
  looksLikeCancel,
  matchPeople,
  redactEmailAddresses,
  redactForwardHeaders,
  senderVerified,
  stripQuoted,
} from "./parse";
import { sendInboundReply } from "./reply";
import type { InboundSettings, InboundStore } from "./store";

// One emailed note, start to finish (ALL-31): decide whether to take it, then file it to
// a person, ask who it's about, or drop it. Events carry ids and a reason only (E6).

export type InboundOutcome =
  | "filed"
  | "asking"
  | "ignored"
  | "unpaid"
  | "capped"
  | "cancel_reply"
  | "disabled"
  /** Accepted, but saving it failed; logged as inbound.failed. */
  | "failed";

export type InboundDeps = {
  store: InboundStore;
  /** The capture store for one user, on the service-role client (captureStoreFor). */
  captureStore: (userId: string) => CaptureStore;
  extract: Extract;
  /** Records what reading the note cost, on the service-role client. */
  recordCost: RecordCost;
  /** Resend's key and fetch, for the received email, its image and sent Message-IDs. */
  resend: ResendDeps;
  /** For the emails sent back; `now` is the handler's clock too. */
  notify: NotifyDeps;
};

/** What every step after the sender is known needs. */
type Ctx = { deps: InboundDeps; emailId: string; userId: string; settings: InboundSettings };

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export async function handleInbound(emailId: string, deps: InboundDeps): Promise<InboundOutcome> {
  const { store } = deps;
  const ignored = (reason: string, userId?: string) =>
    logEvent("inbound.ignored", { email_id: emailId, ...(userId ? { user_id: userId } : {}), reason });

  if (!(await store.enabled())) {
    ignored("disabled");
    return "disabled";
  }

  const email = await fetchReceivedEmail(emailId, deps.resend);
  if (isAutoReply(email.headers)) {
    ignored("auto_reply");
    return "ignored";
  }
  // DMARC first: an unverified From never gets as far as naming an account.
  if (!senderVerified(email.authentication)) {
    ignored("unverified");
    return "ignored";
  }
  const userId = await store.userByEmail(email.from);
  if (!userId) {
    ignored("unknown_sender");
    return "ignored";
  }

  const settings = await store.settings();
  if ((await store.countToday(userId)) >= settings.maxPerDay) {
    ignored("capped", userId);
    return "capped";
  }
  const ctx: Ctx = { deps, emailId, userId, settings };

  // Reading costs money (ALL-94): nothing is kept, and the user is told once ever.
  if (!(await store.hasPaidFeatures(userId))) {
    ignored("unpaid", userId);
    if (await store.claimFlag(userId, "notes_unpaid_reply_sent_at")) {
      await sendBack(ctx, { userId, kind: "notes_not_read", data: {}, links: {} });
    }
    return "unpaid";
  }

  await store.recordEvent(userId);
  try {
    return await accept(ctx, email);
  } catch (err) {
    logEvent("inbound.failed", { email_id: emailId, user_id: userId, ...errorFields(err) });
    return "failed";
  }
}

/** An accepted note: file it to the one person it's about, or ask who. */
async function accept(ctx: Ctx, email: ReceivedEmail): Promise<InboundOutcome> {
  const { deps, emailId, userId, settings } = ctx;
  const captures = deps.captureStore(userId);
  const limits = await captures.limits();
  // The title of a filed note and the subject of an asking one: no addresses either (T42).
  const subject = redactEmailAddresses(email.subject.trim());
  // Saved for both filing and asking, and later read by the AI: no forwarded headers or addresses.
  const text = redactForwardHeaders(stripQuoted(email.text)).slice(0, limits.textMaxChars);
  const image = await loadImage(ctx, email.attachments, limits.screenshotMaxBytes);

  let personId = email.inReplyTo ? await personForReply(ctx, email.inReplyTo) : null;
  const matchedBy = personId ? "reply" : "name";
  if (!personId) {
    const people = await deps.store.people(userId);
    const matched = matchPeople(subject, text, people);
    if (matched.length === 1) personId = matched[0];
    else {
      // Several names: offer those. None: offer everyone.
      const offered = matched.length > 1 ? people.filter((p) => matched.includes(p.id)) : people;
      return ask(ctx, { subject, text, image }, offered.slice(0, settings.maxChoices));
    }
  }

  const saved = await saveNoteCapture(captures, { personId, title: subject, text, image });
  if (!saved.ok) {
    logEvent("inbound.failed", { email_id: emailId, user_id: userId, person_id: personId, status: saved.status });
    return "failed";
  }
  logEvent("inbound.filed", {
    email_id: emailId,
    user_id: userId,
    person_id: personId,
    capture_id: saved.id,
    matched_by: matchedBy,
  });

  try {
    await processCapture(captures, deps.extract, deps.recordCost, saved.id);
  } catch (err) {
    // The capture stays saved and unread; "Try again" on the person's page reads it.
    logEvent("inbound.read_failed", { email_id: emailId, user_id: userId, capture_id: saved.id, ...errorFields(err) });
  }

  if (looksLikeCancel(`${subject}\n${text}`)) {
    await sendBack(ctx, { userId, kind: "notes_cant_cancel", data: {}, links: {} });
    return "cancel_reply";
  }
  return "filed";
}

type Image = { bytes: Uint8Array; type: string };

/** The first image under the size limit, or null. A failed download files the note without it. */
async function loadImage(
  ctx: Ctx,
  attachments: { id: string; content_type: string; size: number }[],
  maxBytes: number,
): Promise<Image | null> {
  const ref = firstImage(attachments, maxBytes);
  if (!ref) return null;
  try {
    const { bytes } = await fetchAttachment(ctx.emailId, ref.id, ctx.deps.resend, maxBytes);
    return { bytes, type: ref.content_type };
  } catch (err) {
    logEvent("inbound.image_failed", { email_id: ctx.emailId, user_id: ctx.userId, ...errorFields(err) });
    return null;
  }
}

/**
 * The person on the notification this email replies to. Resend sets an email's Message-ID a
 * moment after sending, so most notifications have none saved: on a miss the recent ones
 * (inbound_thread_lookup_max, within inbound_thread_lookup_days) are read back from Resend,
 * saved, and the lookup is tried again. A reply to anything older falls back to names.
 */
async function personForReply(ctx: Ctx, inReplyTo: string): Promise<string | null> {
  const { deps, userId, settings } = ctx;
  const { store } = deps;
  const found = await store.personForMessageId(userId, inReplyTo);
  if (found) return found;

  const since = new Date(deps.notify.now.getTime() - settings.threadLookupDays * DAY_MS);
  const pending = await store.unthreadedNotifications(userId, since, settings.threadLookupMax);
  let backfilled = false;
  for (const n of pending) {
    const messageId = await fetchMessageId(n.providerMessageId, deps.resend);
    if (!messageId) continue;
    await store.setMessageId(userId, n.id, messageId);
    backfilled = true;
  }
  return backfilled ? store.personForMessageId(userId, inReplyTo) : null;
}

/** Saves the note as asking, with its image in storage, and sends "Who is this about?". */
async function ask(
  ctx: Ctx,
  note: { subject: string; text: string; image: Image | null },
  choices: { id: string; name: string }[],
): Promise<InboundOutcome> {
  const { deps, emailId, userId, settings } = ctx;
  const { store } = deps;
  let imagePath: string | null = null;
  if (note.image) {
    const path = `${userId}/${randomUUID()}.${IMAGE_EXTENSIONS[note.image.type]}`;
    try {
      await store.uploadImage(path, note.image.bytes, note.image.type);
      imagePath = path;
    } catch (err) {
      logEvent("inbound.image_failed", { email_id: emailId, user_id: userId, ...errorFields(err) });
    }
  }

  const messageId = await store.saveAsking({
    userId,
    subject: note.subject,
    body: note.text,
    imagePath,
    imageType: imagePath ? note.image!.type : null,
  });
  logEvent("inbound.asking", { email_id: emailId, user_id: userId, inbound_message_id: messageId, choices: choices.length });

  const expiresAt = new Date(deps.notify.now.getTime() + settings.linkHours * HOUR_MS);
  const links: Record<string, LinkSpec> = { someoneElse: { path: "/give" } };
  choices.forEach((c, i) => {
    links[`choice${i}`] = { action: "file_note", expiresAt, personId: c.id, inboundMessageId: messageId };
  });
  const sent = await sendBack(ctx, {
    userId,
    kind: "who_is_this",
    data: { subject: note.subject, choices: choices.map((c) => ({ name: c.name })) },
    links: links as NotifyInput<"who_is_this">["links"],
  });
  if (sent !== "capped") return "asking";

  // Nobody will be asked, so don't keep a note nobody can file. Capped means nothing was sent
  // and no buttons were saved. The image goes first: if that fails the row stays, and the daily
  // clear-out (it has no buttons) clears it and retries the image.
  const ids = { email_id: emailId, user_id: userId, inbound_message_id: messageId };
  try {
    if (imagePath) await store.removeImage(imagePath);
    await store.deleteAsking(userId, messageId);
    logEvent("inbound.ask_capped", ids);
  } catch (err) {
    logEvent("inbound.ask_capped", { ...ids, ...errorFields(err) });
  }
  return "capped";
}

/** An email back about this note, under the daily cap (sendInboundReply). */
function sendBack<K extends NotificationKind>(ctx: Ctx, input: NotifyInput<K>) {
  const { deps, emailId, settings } = ctx;
  return sendInboundReply(input, { store: deps.store, maxPerDay: settings.maxPerDay, notify: deps.notify }, { email_id: emailId });
}
