// Sends one sample of every email template to an address, for checking them on a phone.
// Usage: pnpm --filter @gifts-af/web email:samples you@example.com
// Needs RESEND_API_KEY in apps/web/.env.development.local (what `vercel env pull`
// writes), apps/web/.env.local, or already in the environment.
// The package script runs tsx with --conditions=react-server so the module's
// public index (which imports server-only) loads outside Next.
import { existsSync } from "node:fs";
import { sampleEmails } from "@/modules/concierge";
import { sendEmail } from "@/lib/resend";

// This page shows "This link doesn't work", so tapping a sample button is harmless.
const SAMPLE_LINK = "https://giftsaf.com/a/sample";

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage: pnpm --filter @gifts-af/web email:samples you@example.com");
    process.exit(1);
  }
  // Same precedence as Next: .env.development.local wins over .env.local, and
  // loadEnvFile never overrides a value that's already set.
  for (const file of [".env.development.local", ".env.local"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(
      "RESEND_API_KEY is not set. Pull it into apps/web/.env.development.local (vercel env pull, see apps/web/README.md) or add it to apps/web/.env.local, and try again.",
    );
    process.exit(1);
  }

  let failed = 0;
  for (const s of sampleEmails(SAMPLE_LINK)) {
    const email = s.email;
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
