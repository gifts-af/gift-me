import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// Writes gallery/index.html from the screenshots `pnpm gallery` took: one row
// per screen, one column per browser (ALL-000). The page is also published as
// the screens and emails page on claude.ai (CLAUDE.md > Updating the screens
// and emails page), so it follows the artifact page rules: no <html>/<body>
// of its own, colors as tokens with a dark mode, and it fits a phone.
const DIR = path.resolve(__dirname, "../gallery");

// How wide each browser's pictures show on the page.
const SHOW_WIDTH: Record<string, number> = { phone: 240, "phone-dark": 240, desktop: 560 };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export default function writeGalleryIndex() {
  if (!existsSync(DIR)) return;
  const projects = readdirSync(DIR).filter((d) => !d.startsWith(".") && statSync(path.join(DIR, d)).isDirectory()).sort(byProject);
  const names = [...new Set(projects.flatMap((p) => readdirSync(path.join(DIR, p))))]
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.replace(/\.png$/, ""))
    .sort();
  const screens = names.filter((n) => !n.startsWith("email-"));
  const emails = names.filter((n) => n.startsWith("email-"));

  const section = (name: string, label: string) => {
    const cells = projects
      .filter((p) => existsSync(path.join(DIR, p, `${name}.png`)))
      .map(
        (p) =>
          `<figure style="width:${SHOW_WIDTH[p] ?? 320}px"><figcaption>${esc(p)}</figcaption>` +
          `<a href="${p}/${name}.png" target="_blank" rel="noopener"><img src="${p}/${name}.png" loading="lazy" alt="${esc(label)}, ${esc(p)}"></a></figure>`,
      )
      .join("");
    return `<section id="${name}"><h3>${esc(label)}</h3><div class="row">${cells}</div></section>`;
  };
  const chips = (list: string[], strip = "") =>
    list.map((n) => `<a href="#${n}">${esc(n.slice(strip.length))}</a>`).join("");

  writeFileSync(
    path.join(DIR, "index.html"),
    `<meta charset="utf-8">
<title>GiftsAF screens and emails</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* One long scroll: index chips, then a row per screen with phone, phone dark and desktop side by side. */
:root{--bg:#f6f7f7;--panel:#ffffff;--fg:#17201f;--muted:#5d6b69;--line:#d9dfde;--accent:#12776d;--chip:#e7efee}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#101615;--panel:#18201f;--fg:#e8eeed;--muted:#9aa9a7;--line:#2c3836;--accent:#4fb8ab;--chip:#1f2b29;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#101615;--panel:#18201f;--fg:#e8eeed;--muted:#9aa9a7;--line:#2c3836;--accent:#4fb8ab;--chip:#1f2b29;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1240px;margin:0 auto;padding-block:24px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
h1{font-size:26px;margin:0 0 4px;text-wrap:balance}
h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:32px 0 8px}
h3{font-size:16px;margin:0 0 10px}
p{margin:0;color:var(--muted);max-width:65ch}
code{font-size:13px}
nav{display:flex;flex-wrap:wrap;gap:6px}
nav a{background:var(--chip);color:var(--fg);text-decoration:none;border-radius:999px;padding:2px 10px;font-size:13px}
nav a:hover,nav a:focus-visible{background:var(--accent);color:var(--panel);outline:none}
section{border-top:1px solid var(--line);padding-top:16px;margin-top:24px;scroll-margin-top:12px}
.row{display:flex;gap:20px;align-items:flex-start;overflow-x:auto;padding-bottom:8px}
figure{margin:0;flex:none;max-width:100%}
figcaption{font-size:12px;color:var(--muted);margin-bottom:4px}
img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:6px;background:var(--panel)}
a:focus-visible img{outline:2px solid var(--accent);outline-offset:2px}
</style>
<div class="wrap">
<h1>GiftsAF screens and emails</h1>
<p>Every main screen on a phone (light and dark) and on desktop, and every email on a phone, from a fresh test account with one person and a one-gift list. Taken ${new Date().toISOString().slice(0, 10)} by <code>pnpm gallery</code>. Open a picture for full size.</p>
<h2>Jump to a screen (${screens.length})</h2>
<nav>${chips(screens)}</nav>
<h2>Jump to an email (${emails.length})</h2>
<nav>${chips(emails, "email-")}</nav>
<h2>Screens</h2>
${screens.map((n) => section(n, n)).join("\n")}
<h2>Emails</h2>
${emails.map((n) => section(n, `Email: ${n.slice(6)}`)).join("\n")}
</div>
`,
  );
  console.log(`Gallery: ${path.join(DIR, "index.html")}`);
}

function byProject(a: string, b: string) {
  const order = ["phone", "phone-dark", "desktop"];
  return (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b);
}
