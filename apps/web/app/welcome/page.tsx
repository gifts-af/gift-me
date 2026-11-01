import type { Metadata } from "next";
import { Concierge } from "@/components/home/concierge";
import { Features } from "@/components/home/features";
import { Feedback } from "@/components/home/feedback";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeTopBar } from "@/components/home/home-top-bar";
import { Hook } from "@/components/home/hook";
import { ListHook } from "@/components/home/list-hook";
import { Steps } from "@/components/home/steps";
import { APP_NAME } from "@/lib/brand";

// The public home page (ALL-46). Signed-out visitors to "/" see it (proxy.ts
// rewrites there); signed-in users keep their app home. Light and dark follow
// the browser, like the rest of the app. It leads with the list, which works
// today, then the concierge hook (ALL-71).
export const metadata: Metadata = {
  title: APP_NAME,
  description:
    "Gifting, handled AF. We remember the dates, find the gift, and ship it. You just tap yes. Early alpha.",
};

export default function WelcomePage() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <HomeTopBar howItWorks />
      <main>
        <ListHook />
        <Hook />
        <Concierge />
        <Features />
        <Steps />
        <Feedback />
      </main>
      <HomeFooter />
    </div>
  );
}
