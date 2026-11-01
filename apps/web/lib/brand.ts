// The platform's public name (ALL-14, planning decision 44). Code names
// (`gift-me`, `lists`, `concierge`) stay as they are (T21); only what users
// see uses this.
export const APP_NAME = "GiftsAF";
export const APP_DOMAIN = "giftsaf.com";
export const APP_TAGLINE = "The right gift, on time, without the scramble.";

// The home page's hook and pitch (ALL-46), reused for link previews (ALL-55).
export const APP_HOOK = "Gifting, handled AF.";
export const APP_PITCH = "We remember the dates, find the gift, and ship it. You just tap yes.";

// Where feedback and access requests go (ALL-47, ALL-53). There's no inbox at
// giftsaf.com yet, so they reach the owner directly.
export const FEEDBACK_EMAIL = "allensforever711@gmail.com";

// Each form emails a Gmail plus-address of that inbox, so Gmail filters and
// labels can sort them (ALL-71): allensforever711+access@gmail.com and so on.
export function inboxFor(tag: "access" | "waitlist" | "feedback"): string {
  const at = FEEDBACK_EMAIL.indexOf("@");
  return `${FEEDBACK_EMAIL.slice(0, at)}+${tag}${FEEDBACK_EMAIL.slice(at)}`;
}

// The sender on every email we send (T33).
export const EMAIL_FROM = `${APP_NAME} <hello@giftsaf.com>`;
