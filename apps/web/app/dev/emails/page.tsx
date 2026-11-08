import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { sampleFormEmails } from "@/lib/form-email-samples";
import { sampleEmails } from "@/modules/concierge";

// Every email we send, rendered from its sample data, for reviewing by eye
// (ALL-000). The same samples feed the phone-layout test and `pnpm gallery`.
// Only under `pnpm dev` and on Vercel previews; everywhere else returns 404.
// Checked per request, not at build, so a preview promoted to production hides
// it too. Signing in is still required, like every page that isn't public.
const LINK = "https://giftsaf.com/a/sample";

// Each email at a phone's width and at a typical desktop mail pane's.
const WIDTHS = [375, 600];

export default function EmailsPage() {
  return (
    <Suspense>
      <Emails />
    </Suspense>
  );
}

async function Emails() {
  await connection();
  const allowed = process.env.NODE_ENV === "development" || process.env.VERCEL_ENV === "preview";
  if (!allowed) notFound();

  const emails = [
    ...sampleEmails(LINK).map(({ name, email }) => ({ name, subject: email.subject, html: email.html })),
    ...sampleFormEmails().map(({ name, html }) => ({ name, subject: "", html })),
  ];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-[22px] font-bold">Emails ({emails.length})</h1>
        <p className="text-sm text-muted-foreground">
          Rendered from sample data. Only on local dev and previews.
        </p>
        <nav className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {emails.map((e) => (
            <a key={e.name} href={`#${e.name}`} className="underline">
              {e.name}
            </a>
          ))}
        </nav>
      </header>
      {emails.map((e) => (
        <section key={e.name} id={e.name} className="flex scroll-mt-4 flex-col gap-2 border-t pt-4">
          <h2 className="font-semibold">{e.name}</h2>
          {e.subject && <p className="text-sm text-muted-foreground">Subject: {e.subject}</p>}
          <div className="flex flex-wrap gap-4">
            {WIDTHS.map((w) => (
              <iframe
                key={w}
                title={`${e.name} at ${w} px`}
                srcDoc={e.html}
                sandbox=""
                width={w}
                height={760}
                className="max-w-full rounded border bg-white"
              />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
