// Sends one sample of every email template to an address, for checking them on a phone.
// Usage: pnpm --filter @gifts-af/web email:samples you@example.com
// Needs RESEND_API_KEY in apps/web/.env.local (or already in the environment).
import { existsSync } from "node:fs";
import { SAMPLE_DATA, TEMPLATES, type NotificationKind } from "@/modules/concierge/notify/templates";
import { sendEmail } from "@/lib/resend";

// This page shows "This link doesn't work", so tapping a sample button is harmless.
const SAMPLE_LINK = "https://giftsaf.com/a/sample";

type Sample = { name: string; render: () => { subject: string; html: string; text: string } };

function allLinksToSample<T extends object>(links: T): T {
  return Object.fromEntries(Object.keys(links).map((k) => [k, SAMPLE_LINK])) as T;
}

function samples(): Sample[] {
  const list: Sample[] = [];
  for (const kind of Object.keys(SAMPLE_DATA) as NotificationKind[]) {
    const { data, links } = SAMPLE_DATA[kind];
    const render = TEMPLATES[kind] as (d: unknown, l: unknown) => ReturnType<Sample["render"]>;
    if (kind === "heads_up") {
      const base = SAMPLE_DATA.heads_up.data;
      const autoBuy = { ...base, mode: "auto_buy", autoBuyIdea: base.ideas[0].title, autoBuyDate: "Tuesday, March 10" };
      list.push({ name: "heads_up (reminder)", render: () => render(base, { ...allLinksToSample(links) }) });
      list.push({
        name: "heads_up (auto-buy)",
        render: () => render(autoBuy, { ...allLinksToSample(links), skip: SAMPLE_LINK }),
      });
    } else {
      list.push({ name: kind, render: () => render(data, allLinksToSample(links)) });
    }
  }
  return list;
}

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage: pnpm --filter @gifts-af/web email:samples you@example.com");
    process.exit(1);
  }
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set. Add it to apps/web/.env.local (see README) and try again.");
    process.exit(1);
  }

  let failed = 0;
  for (const s of samples()) {
    const email = s.render();
    const result = await sendEmail({ to, ...email, subject: `[Sample] ${email.subject}` }, { apiKey, fetch });
    if (result.ok) console.log(`sent    ${s.name}`);
    else {
      failed++;
      console.error(`FAILED  ${s.name}: ${result.error}`);
    }
  }
  if (failed) process.exit(1);
}

main();
