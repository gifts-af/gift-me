import { randomUUID } from "node:crypto";
import type { Extract } from "@/lib/ai/extract";
import { errorFields, logEvent } from "@/lib/log";
import { fetchMessageId } from "@/lib/resend";
import { fetchAttachment, fetchReceivedEmail, type Deps as ResendDeps } from "@/lib/resend-inbound";
import { IMAGE_EXTENSIONS, saveNoteCapture } from "../capture/capture";
import { processCapture } from "../capture/extract";
import type { CaptureStore } from "../capture/store";
import { notify, type LinkSpec, type NotifyDeps, type NotifyInput } from "../notify/notify";
import type { NotificationKind } from "../notify/templates";
import { firstImage, isAutoReply, looksLikeCancel, matchPeople, senderVerified, stripQuoted } from "./parse";
import type { InboundStore } from "./store";

// One emailed note, start to finish (ALL-31): decide whether to take it, then file it to
// a person, ask who it's about, or drop it. Events carry ids and a reason only (E6).

export type InboundOutcome = "filed" | "asking" | "ignored" | "unpaid" | "capped" | "cancel_reply" | "disabled";

export type InboundDeps = {
  store: InboundStore;
  /** The capture store for one user, on the service-role client (captureStoreFor). */
  captureStore: (userId: string) => CaptureStore;
  extract: Extract;
  /** Resend's key and fetch, for the received email, its image and sent Message-IDs. */
  resend: ResendDeps;
  /** For the emails sent back; `now` is the handler's clock too. */
  notify: NotifyDeps;
};

/**
 * How far back a reply's In-Reply-To is looked for among notifications whose Message-ID was
 * never read back: Resend sets it about a second after sending, so most rows have none. Bounded
 * because each candidate is one Resend call; a reply to anything older falls back to names.
 */
const THREAD_LOOKUP = { maxNotifications: 10, maxAgeDays: 60 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

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

  // Reading costs money (ALL-94): nothing is kept, and the user is told once ever.
  if (!(await store.hasPaidFeatures(userId))) {
    ignored("unpaid", userId);
    if (await store.claimFlag(userId, "notes_unpaid_reply_sent_at")) {
      await sendBack(deps, emailId, { userId, kind: "notes_not_read", data: {}, links: {} });
    }
    return "unpaid";
  }

  await store.recordEvent(userId);

  const captures = deps.captureStore(userId);
  const limits = await captures.limits();
  const subject = email.subject.trim();
  const text = stripQuoted(email.text).slice(0, limits.textMaxChars);
  const image = await loadImage(deps, emailId, userId, email.attachments, limits.screenshotMaxBytes);

  let personId = email.inReplyTo ? await personForReply(deps, userId, email.inReplyTo) : null;
  const matchedBy = personId ? "reply" : "name";
  if (!personId) {
    const people = await store.people(userId);
    const matched = matchPeople(subject, text, people);
    if (matched.length === 1) personId = matched[0];
    else {
      // Several names: offer those. None: offer everyone.
      const offered = matched.length > 1 ? people.filter((p) => matched.includes(p.id)) : people;
      return ask(deps, emailId, userId, settings, { subject, text, image }, offered.slice(0, settings.maxChoices));
    }
  }

  const saved = await saveNoteCapture(captures, { personId, title: subject, text, image });
  if (!saved.ok) {
    logEvent("inbound.save_failed", { email_id: emailId, user_id: userId, person_id: personId, status: saved.status });
    return "ignored";
  }
  logEvent("inbound.filed", {
    email_id: emailId,
    user_id: userId,
    person_id: personId,
    capture_id: saved.id,
    matched_by: matchedBy,
  });

  try {
    await processCapture(captures, deps.extract, saved.id);
  } catch (err) {
    // The capture stays saved and unread; "Try again" on the person's page reads it.
    logEvent("inbound.read_failed", { email_id: emailId, user_id: userId, capture_id: saved.id, ...errorFields(err) });
  }

  if (looksLikeCancel(`${subject}\n${text}`)) {
    await sendBack(deps, emailId, { userId, kind: "notes_cant_cancel", data: {}, links: {} });
    return "cancel_reply";
  }
  return "filed";
}

type Image = { bytes: Uint8Array; type: string };

/** The first image under the size limit, or null. A failed download files the note without it. */
async function loadImage(
  deps: InboundDeps,
  emailId: string,
  userId: string,
  attachments: { id: string; content_type: string; size: number }[],
  maxBytes: number,
): Promise<Image | null> {
  const ref = firstImage(attachments, maxBytes);
  if (!ref) return null;
  try {
    const { bytes } = await fetchAttachment(emailId, ref.id, deps.resend, maxBytes);
    return { bytes, type: ref.content_type };
  } catch (err) {
    logEvent("inbound.image_failed", { email_id: emailId, user_id: userId, ...errorFields(err) });
    return null;
  }
}

/**
 * The person on the notification this email replies to. Our sent notifications usually have no
 * Message-ID saved yet, so on a miss the recent ones are read back from Resend, saved, and the
 * lookup is tried again.
 */
async function personForReply(deps: InboundDeps, userId: string, inReplyTo: string): Promise<string | null> {
  const { store } = deps;
  const found = await store.personForMessageId(userId, inReplyTo);
  if (found) return found;

  const since = new Date(deps.notify.now.getTime() - THREAD_LOOKUP.maxAgeDays * DAY_MS);
  const pending = await store.unthreadedNotifications(userId, since, THREAD_LOOKUP.maxNotifications);
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
  deps: InboundDeps,
  emailId: string,
  userId: string,
  settings: { linkHours: number },
  note: { subject: string; text: string; image: Image | null },
  choices: { id: string; name: string }[],
): Promise<InboundOutcome> {
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

  const expiresAt = new Date(deps.notify.now.getTime() + settings.linkHours * 60 * 60 * 1000);
  const links: Record<string, LinkSpec> = { someoneElse: { path: "/people" } };
  choices.forEach((c, i) => {
    links[`choice${i}`] = { action: "file_note", expiresAt, personId: c.id, inboundMessageId: messageId };
  });
  await sendBack(deps, emailId, {
    userId,
    kind: "who_is_this",
    data: { subject: note.subject, choices: choices.map((c) => ({ name: c.name })) },
    links: links as NotifyInput<"who_is_this">["links"],
  });
  return "asking";
}

/**
 * Every email sent back counts toward the daily cap, counted before sending so a failing send
 * can't loop uncounted. A failed send is logged; the note itself is already handled.
 */
async function sendBack<K extends NotificationKind>(deps: InboundDeps, emailId: string, input: NotifyInput<K>) {
  const ids = { email_id: emailId, user_id: input.userId, kind: input.kind };
  try {
    await deps.store.recordEvent(input.userId);
    const result = await notify(input, deps.notify);
    if (!result.ok) logEvent("inbound.reply_failed", ids);
  } catch (err) {
    logEvent("inbound.reply_failed", { ...ids, ...errorFields(err) });
  }
}
