import { siteUrl } from "@/lib/site-url";
import {
  createStubGenerateIdeas,
  createSupabaseNotifyStore,
  createSupabaseRoundStore,
  defaultChannels,
  runTick,
} from "@/modules/concierge";
import { handleTick } from "./tick";

// Called daily by Vercel Cron (vercel.json). Reads a request header, so it runs on every call.
export async function GET(request: Request) {
  const vercelEnv = process.env.VERCEL_ENV;
  return handleTick(request, { cronSecret: process.env.CRON_SECRET, vercelEnv }, (now) =>
    runTick({
      store: createSupabaseRoundStore(),
      notify: { store: createSupabaseNotifyStore(), channels: defaultChannels(), baseUrl: siteUrl(), now },
      now,
      generateIdeas: createStubGenerateIdeas({ production: vercelEnv === "production" }),
    }),
  );
}
