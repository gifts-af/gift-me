import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeTopBar } from "@/components/home/home-top-bar";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Privacy · ${APP_NAME}`,
  description: `What ${APP_NAME} and its Chrome extension collect, where it's kept, and how to delete it.`,
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[19px] font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

// The privacy policy, in plain words (ALL-65). The Chrome Web Store listing
// links here, and its data-use answers must match it. Public, like /tour.
export default function PrivacyPage() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <HomeTopBar />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-4 pb-12 pt-6 text-[15px] leading-relaxed">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">Privacy</h1>
          <p className="text-muted-foreground">Last updated 16 November 2026</p>
        </div>

        <p>
          <strong>The short version:</strong> {APP_NAME} only sees what you choose to give it. We use it to help you
          pick gifts, and for nothing else. We don&apos;t sell it, and we don&apos;t use it for ads.
        </p>

        <Section title="The Chrome extension">
          <p>
            The extension does nothing until you click <strong>Save</strong>. Then, for that one tab, it sends:
          </p>
          <ul className="list-disc pl-5">
            <li>the page&apos;s address and title</li>
            <li>the text you can see on the page</li>
            <li>a screenshot of what&apos;s on screen</li>
            <li>the person you picked, and any note you typed</li>
          </ul>
          <p>
            It never reads your browsing history, never runs in the background, and never looks at a page you
            didn&apos;t save. It asks Chrome for three permissions: <em>activeTab</em> (the tab you clicked on, only
            when you click), <em>scripting</em> (to read that tab&apos;s text) and <em>storage</em> (to keep you signed
            in).
          </p>
        </Section>

        <Section title="Where it's kept">
          <p>
            Captures are saved to your {APP_NAME} account. Screenshots go in private storage that only your account
            can open. Other people, including people whose lists you use, can&apos;t see your captures or notes. Our
            data is hosted by Supabase and Vercel.
          </p>
        </Section>

        <Section title="What the AI reads">
          <p>
            To learn what someone might like, we send a capture&apos;s text and screenshot to an AI model (Anthropic&apos;s
            Claude, through Vercel&apos;s AI Gateway). We tell it how you know the person, never their name. What it
            finds shows on the person&apos;s page as AI suggestions, marked as such, and you can turn off or remove any
            of them.
          </p>
        </Section>

        <Section title="Deleting it">
          <ul className="list-disc pl-5">
            <li>Remove any suggestion from the person&apos;s page.</li>
            <li>Delete a person to remove them, and everything saved about them, from your account.</li>
            <li>
              Uninstall the extension, or sign out of it, to remove its sign-in from your browser.
            </li>
            <li>
              To have your whole account and its files erased for good, send us a note from{" "}
              <Link href="/feedback" className="font-semibold text-primary underline-offset-2 hover:underline">
                Feedback
              </Link>{" "}
              and we&apos;ll do it.
            </li>
          </ul>
        </Section>

        <Section title="Questions">
          <p>
            {APP_NAME} is made by two people. Ask us anything through{" "}
            <Link href="/feedback" className="font-semibold text-primary underline-offset-2 hover:underline">
              Feedback
            </Link>
            .
          </p>
        </Section>
      </main>
      <HomeFooter />
    </div>
  );
}
