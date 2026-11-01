// Shared email shell (T33): white background, 600px max, system fonts, inline
// styles only (no <style>, no classes), exactly one teal button.

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
  button: { label: string; url: string };
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
    `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">` +
    `<div style="max-width:600px;margin:0 auto;padding:24px 20px;background:#ffffff;font-family:${FONT}">` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK}">${escapeHtml(parts.heading)}</h1>` +
    parts.paragraphs.map((s) => para(s)).join("") +
    (rows ? `<div style="margin:0 0 24px;border-bottom:1px solid ${RULE}">${rows}</div>` : "") +
    `<p style="margin:0 0 24px"><a href="${escapeHtml(parts.button.url)}" style="display:inline-block;background:${TEAL};color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:12px 20px;border-radius:8px">${escapeHtml(parts.button.label)}</a></p>` +
    (parts.footer ? para(parts.footer, MUTED, 14) : "") +
    `</div></body></html>`;

  const lines = [parts.heading, "", ...parts.paragraphs.flatMap((s) => [s, ""])];
  if (parts.rows?.length) {
    for (const r of parts.rows) lines.push(r.detail ? `- ${r.title} (${r.detail})` : `- ${r.title}`);
    lines.push("");
  }
  lines.push(`${parts.button.label}: ${parts.button.url}`);
  if (parts.footer) lines.push("", parts.footer);

  return { html, text: lines.join("\n") };
}
