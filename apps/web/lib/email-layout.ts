// Shared email shell (T33): white background, 600px max, system fonts, inline
// styles only (no <style>, no classes), the GiftsAF wordmark on top (ALL-71)
// and at most one teal button. Shared by the concierge's notifications and the
// public forms (access requests, waitlist, feedback), so it lives in lib.
import { APP_DOMAIN, APP_NAME } from "@/lib/brand";

// A PNG, since Gmail doesn't show SVG (app/email-logo.png/route.tsx). Drawn at
// twice the size it's shown, for sharp phone screens.
export const EMAIL_LOGO_URL = `https://${APP_DOMAIN}/email-logo.png`;
export const EMAIL_LOGO_SIZE = { width: 120, height: 40 };

// The light-theme `--primary` token in app/globals.css (175 77% 26%). Email is
// always light, so this is a fixed hex rather than a CSS variable.
const TEAL = "#0f766e";
const INK = "#18181b";
const MUTED = "#52525b";
const RULE = "#e4e4e7";
// The warning box (ALL-32 mock-ups): amber, like Tailwind's amber-50/700/800.
const WARN_BG = "#fffbeb";
const WARN_RULE = "#b45309";
const WARN_INK = "#92400e";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A plain link, with optional words in front of it on the same line ("Changed your mind? Cancel this gift"). */
export type EmailLink = { label: string; url: string; before?: string };

export type EmailParts = {
  heading: string;
  paragraphs: string[];
  rows?: { title: string; detail?: string }[];
  /** An amber box above the button, its lead in bold (ALL-32: "Your Zinc balance is low."). */
  warning?: { lead: string; text: string };
  button?: { label: string; url: string };
  /** A small amber note right under the button (ALL-32: the alpha money line). */
  note?: string;
  /** A small grey line after the note, before the plain links (ALL-32: the auto top-up tip). */
  tip?: string;
  /** Plain links under the button, for something optional: never a second button. */
  link?: EmailLink | EmailLink[];
  footer?: string;
};

export function renderEmail(parts: EmailParts): { html: string; text: string } {
  // text-wrap: balanced headings and no lone last word (ALL-32, design/ui.md); mail apps that
  // don't know it just ignore it.
  const para = (s: string, color = INK, size = 16) =>
    `<p style="margin:0 0 16px;font-size:${size}px;line-height:1.5;color:${color};text-wrap:pretty">${escapeHtml(s)}</p>`;
  const links = parts.link === undefined ? [] : Array.isArray(parts.link) ? parts.link : [parts.link];

  const rows = (parts.rows ?? [])
    .map(
      (r) =>
        `<div style="padding:12px 0;border-top:1px solid ${RULE}">` +
        `<div style="font-size:16px;font-weight:600;color:${INK}">${escapeHtml(r.title)}</div>` +
        (r.detail
          ? `<div style="font-size:14px;color:${MUTED}">${escapeHtml(r.detail)}</div>`
          : "") +
        `</div>`,
    )
    .join("");

  const html =
    // The viewport tag makes phone mail apps lay it out at the screen's
    // width instead of a 980px desktop width shrunk to fit (ALL-60).
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#ffffff">` +
    `<div style="max-width:600px;margin:0 auto;padding:24px 20px;background:#ffffff;font-family:${FONT}">` +
    `<p style="margin:0 0 20px"><img src="${EMAIL_LOGO_URL}" width="${EMAIL_LOGO_SIZE.width}" height="${EMAIL_LOGO_SIZE.height}" alt="${APP_NAME}" style="display:block;border:0;height:${EMAIL_LOGO_SIZE.height}px;width:${EMAIL_LOGO_SIZE.width}px"></p>` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK};text-wrap:balance">${escapeHtml(parts.heading)}</h1>` +
    parts.paragraphs.map((s) => para(s)).join("") +
    (rows ? `<div style="margin:0 0 24px;border-bottom:1px solid ${RULE}">${rows}</div>` : "") +
    (parts.warning
      ? `<p style="margin:0 0 24px;padding:12px 14px;border-left:3px solid ${WARN_RULE};border-radius:6px;background:${WARN_BG};font-size:15px;line-height:1.5;color:${INK};text-wrap:pretty">` +
        `<strong style="color:${WARN_INK}">${escapeHtml(parts.warning.lead)}</strong> ${escapeHtml(parts.warning.text)}</p>`
      : "") +
    // A fixed line height keeps the button 48px tall whatever the phone's
    // fonts, above the 44px tap minimum (ALL-60).
    (parts.button
      ? `<p style="margin:0 0 24px"><a href="${escapeHtml(parts.button.url)}" style="display:inline-block;background:${TEAL};color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;line-height:20px;padding:14px 20px;border-radius:8px">${escapeHtml(parts.button.label)}</a></p>`
      : "") +
    (parts.note
      ? `<p style="margin:0 0 16px;padding:8px 10px;border-radius:6px;background:${WARN_BG};font-size:13px;line-height:1.5;color:${WARN_INK};text-wrap:pretty">${escapeHtml(parts.note)}</p>`
      : "") +
    (parts.tip ? para(parts.tip, MUTED, 14) : "") +
    // Padding keeps each one above the 44px tap minimum (ALL-60).
    links
      .map((l) =>
        l.before
          ? `<p style="margin:0 0 16px;font-size:14px;line-height:20px;color:${MUTED};text-wrap:pretty">${escapeHtml(l.before)} ` +
            `<a href="${escapeHtml(l.url)}" style="display:inline-block;color:${INK};font-size:14px;line-height:20px;padding:12px 0">${escapeHtml(l.label)}</a></p>`
          : `<p style="margin:0 0 16px"><a href="${escapeHtml(l.url)}" style="display:inline-block;color:${INK};font-size:16px;line-height:20px;padding:12px 0">${escapeHtml(l.label)}</a></p>`,
      )
      .join("") +
    (parts.footer ? para(parts.footer, MUTED, 14) : "") +
    `</div></body></html>`;

  const lines = [parts.heading, "", ...parts.paragraphs.flatMap((s) => [s, ""])];
  if (parts.rows?.length) {
    for (const r of parts.rows) lines.push(r.detail ? `- ${r.title} (${r.detail})` : `- ${r.title}`);
    lines.push("");
  }
  if (parts.warning) lines.push(`${parts.warning.lead} ${parts.warning.text}`, "");
  if (parts.button) lines.push(`${parts.button.label}: ${parts.button.url}`);
  if (parts.note) lines.push("", parts.note);
  if (parts.tip) lines.push(parts.tip);
  for (const l of links) lines.push(`${l.before ? `${l.before} ` : ""}${l.label}: ${l.url}`);
  if (parts.footer) lines.push("", parts.footer);

  return { html, text: lines.join("\n") };
}
