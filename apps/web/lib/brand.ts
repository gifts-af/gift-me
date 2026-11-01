// The platform's public name (ALL-14, planning decision 44). Code names
// (`gift-me`, `lists`, `concierge`) stay as they are (T21); only what users
// see uses this.
export const APP_NAME = "GiftsAF";
export const APP_TAGLINE = "The right gift, on time, without the scramble.";

// Where alpha feedback and access requests go (ALL-46, ALL-47). There's no inbox at
// giftsaf.com yet, so they reach the owner directly.
export const FEEDBACK_EMAIL = "allensforever711@gmail.com";

function mailto(subject: string) {
  const query = `subject=${encodeURIComponent(subject)}`;
  return `mailto:${FEEDBACK_EMAIL}?${query}`;
}

export function feedbackHref() {
  return mailto(`${APP_NAME} alpha feedback`);
}
