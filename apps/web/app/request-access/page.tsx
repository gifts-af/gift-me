import type { Metadata } from "next";
import Link from "next/link";
import { HomeTopBar } from "@/components/home/home-top-bar";
import { APP_NAME } from "@/lib/brand";
import { RequestAccessForm } from "./request-access-form";

export const metadata: Metadata = {
  title: `Request access · ${APP_NAME}`,
  description: `${APP_NAME} is invite only for now. Ask to get in.`,
};

// Low-friction access requests (ALL-47): two fields and a button.
export default function RequestAccessPage() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <HomeTopBar />
      <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pb-12 pt-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">Want in?</h1>
          <p className="text-[15px] text-muted-foreground">
            {APP_NAME} is invite only while it&apos;s in early alpha. Leave your name and email and we&apos;ll let you in.
          </p>
        </div>
        <RequestAccessForm />
        <Link href="/tour" className="inline-flex min-h-11 items-center self-center text-[14px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground">
          Not sure yet? Take the tour
        </Link>
      </main>
    </div>
  );
}
