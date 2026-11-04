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
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailParts = {
  heading: string;
  paragraphs: string[];
  rows?: { title: string; detail?: string }[];
  button?: { label: string; url: string };
  /** A plain link under the button, for something optional: never a second button. */
  link?: { label: string; url: string };
  footer?: string;
};

export function renderEmail(parts: EmailParts): { html: string; text: string } {
  const para = (s: string, color = INK, size = 16) =>
    `<p style="margin:0 0 16px;font-size:${size}px;line-height:1.5;color:${color}">${escapeHtml(s)}</p>`;

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
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK}">${escapeHtml(parts.heading)}</h1>` +
    parts.paragraphs.map((s) => para(s)).join("") +
    (rows ? `<div style="margin:0 0 24px;border-bottom:1px solid ${RULE}">${rows}</div>` : "") +
    // A fixed line height keeps the button 48px tall whatever the phone's
    // fonts, above the 44px tap minimum (ALL-60).
    (parts.button
      ? `<p style="margin:0 0 24px"><a href="${escapeHtml(parts.button.url)}" style="display:inline-block;background:${TEAL};color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;line-height:20px;padding:14px 20px;border-radius:8px">${escapeHtml(parts.button.label)}</a></p>`
      : "") +
    // Padding keeps it above the 44px tap minimum (ALL-60).
    (parts.link
      ? `<p style="margin:0 0 16px"><a href="${escapeHtml(parts.link.url)}" style="display:inline-block;color:${INK};font-size:16px;line-height:20px;padding:12px 0">${escapeHtml(parts.link.label)}</a></p>`
      : "") +
    (parts.footer ? para(parts.footer, MUTED, 14) : "") +
    `</div></body></html>`;

  const lines = [parts.heading, "", ...parts.paragraphs.flatMap((s) => [s, ""])];
  if (parts.rows?.length) {
    for (const r of parts.rows) lines.push(r.detail ? `- ${r.title} (${r.detail})` : `- ${r.title}`);
    lines.push("");
  }
  if (parts.button) lines.push(`${parts.button.label}: ${parts.button.url}`);
  if (parts.link) lines.push(`${parts.link.label}: ${parts.link.url}`);
  if (parts.footer) lines.push("", parts.footer);

  return { html, text: lines.join("\n") };
}
