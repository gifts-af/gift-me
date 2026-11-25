import type { Metadata } from "next";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeTopBar } from "@/components/home/home-top-bar";
import { APP_NAME } from "@/lib/brand";
import { FeedbackForm } from "./feedback-form";

export const metadata: Metadata = {
  title: `Feedback · ${APP_NAME}`,
  description: `Tell us what broke, ask a question, or ask ${APP_NAME} to erase your data.`,
};

// Public: someone with no account must be able to ask us to erase what we hold.
export default function FeedbackPage() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <HomeTopBar />
      <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pb-12 pt-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">Tell us</h1>
          <p className="text-[15px] text-muted-foreground">
            Something broken, a question, or an idea? It goes straight to Jim and Aaron.
          </p>
          <p className="text-[15px] text-muted-foreground">
            To ask us to erase data, leave your email so we can check it&apos;s you and tell you when it&apos;s done.
          </p>
        </div>
        <FeedbackForm
          sentNote="It's in our inbox. If you left your email, we'll reply there."
          question="What would you like to tell us?"
          placeholder="Something broke, or please erase…"
        />
      </main>
      <HomeFooter />
    </div>
  );
}
