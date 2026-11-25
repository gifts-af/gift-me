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

const LINK = "font-semibold text-primary underline-offset-2 hover:underline";

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
          <p className="text-muted-foreground">Last updated 25 November 2026</p>
        </div>

        <p>
          <strong>The short version:</strong> {APP_NAME} only sees what you choose to give it. We use it to help you
          pick gifts, and for nothing else. We don&apos;t sell it, and we don&apos;t use it for ads.
        </p>

        <Section title="What your account keeps">
          <p>
            Signing up saves your email and, if you give one, your name. If you use a password, only a scrambled copy is
            kept, which can&apos;t be read back. Signing in records when, and the internet address and browser it came
            from. Google sign-in also saves the name and picture link from your Google account.
          </p>
          <p>
            After that we keep what you add: your lists and gifts, the gifts you claim, your settings and time zone, your
            own address if you enter it, a phone number if you set up paying for gifts, the people you add, and any gift
            ideas, orders and emailed notes. An emailed note we can&apos;t match to a person is cleared within four days.
          </p>
          <p>
            Anyone with your list&apos;s link can see your name and the list. If you share your address, people
            who linked your list see your city and state, and gifts they order can ship to you. Someone who orders
            through their own Zinc account may be able to see the full address there.
          </p>
          <p>
            When you claim a gift on someone&apos;s list, everyone with the list&apos;s link sees who claimed it, by name,
            never by email, except its owner when they&apos;re signed in. The name is the one on your account, or the
            one you typed if you weren&apos;t signed in. Signing up with Google starts your account with your Google name.
            If your account has no name, or you clear it, claims you make after that say &quot;Someone&quot;. Changing or
            clearing your name doesn&apos;t change claims you already made.
          </p>
        </Section>

        <Section title="What you save about other people">
          <p>
            You can save other people&apos;s names, birthdays, photos, addresses and phone numbers, and what they
            like. It&apos;s private to your account: no other user sees it, and it goes only to the services listed below, when they need
            it. We look only to fix a problem, or to find someone who asks us to erase what&apos;s kept about them. Photos
            go in private storage.
          </p>
        </Section>

        <Section title="Google sign-in and contacts">
          <p>
            <strong>Continue with Google</strong> gives us your name, email and profile picture link. It doesn&apos;t
            give us your contacts.
          </p>
          <p>
            <strong>Importing from Google Contacts</strong> is off for now. When it&apos;s on, it runs only when you start
            it and agree on Google&apos;s screen. Your browser reads your contacts&apos; names, nicknames, birthdays,
            addresses and photos, and shows you a list. We save only the ones you tick: their name, birthday, address and
            photo, and Google&apos;s id for the contact, so nobody is added twice. Our server copies the ticked
            contacts&apos; photos from Google; the rest of your contacts never reach it. As soon as your browser has read
            them, it asks Google to end our access, and we never store it.
          </p>
          <p>
            What comes from Google is never sold and never used for ads. {APP_NAME}&apos;s use of information received
            from Google APIs will adhere to{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" className={LINK}>
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </Section>

        <Section title="The Chrome extension">
          <p>
            When you click the extension&apos;s icon, it reads the tab you&apos;re on, on your computer, to fill in the
            gift or the page you&apos;re saving. Nothing leaves your computer until you press <strong>Add</strong> or{" "}
            <strong>Save</strong>. Its single purpose is to save gifts and gift ideas from any page to {APP_NAME}.
          </p>
          <p>
            <strong>Add to my list</strong> sends the product&apos;s name, price, link and store, its product ID, a
            cropped photo from your screen, and the list it goes on. The photo is stored at a public address that only
            this gift uses. The address keeps working after you turn sharing off or reset your link; when you remove the
            gift, the photo is deleted within a day. <strong>Save</strong> for a person sends:
          </p>
          <ul className="list-disc pl-5">
            <li>the page&apos;s address and title</li>
            <li>the page&apos;s text</li>
            <li>a screenshot of what&apos;s on screen</li>
            <li>the person you picked, and any note you typed</li>
          </ul>
          <p>
            It never reads your browsing history, never runs in the background, and never looks at a tab you didn&apos;t
            open it on. It asks Chrome for three permissions: <em>activeTab</em> (the tab you clicked on, only when you
            click), <em>scripting</em> (to read that tab) and <em>storage</em> (to keep you signed in). To show your
            people in the extension, it loads their names from your account.
          </p>
        </Section>

        <Section title="Where it's kept">
          <p>
            Captures are saved to your {APP_NAME} account. Screenshots go in private storage. Other people, including
            people whose lists you use, can&apos;t see your captures or notes; we can, only to fix a problem. A gift
            photo you add to your list is the exception: it&apos;s public, as described above.
          </p>
        </Section>

        <Section title="What the AI reads">
          <p>
            To learn what someone might like, we send a capture (its address, title, text, screenshot and your note) to
            an AI model, along with what we already know about the person and how you know them. We don&apos;t send the
            name we have on file for them, though the page or your note may contain it. What it finds shows on the
            person&apos;s page as AI suggestions, marked as such, and you can turn off or remove any of them.
          </p>
          <p>
            To find gift ideas, when you ask or when a gift date is near, we send an AI model the occasion and budget,
            how you know the person, what we know they like, and gifts already suggested. It may search the web with
            that. We don&apos;t send their name or address, though what you wrote about them may contain it.
          </p>
        </Section>

        <Section title="Who else handles it">
          <p>We share data only with the services that run {APP_NAME}, and only what each one needs:</p>
          <ul className="list-disc pl-5">
            <li>Supabase stores the data, and Vercel runs the site.</li>
            <li>Anthropic&apos;s Claude, through Vercel&apos;s AI Gateway, reads captures and suggests gift ideas.</li>
            <li>Resend sends our emails and receives the notes you email us. Feedback and concierge requests reach us in Gmail.</li>
            <li>Cloudflare checks that our public forms are used by people, not bots.</li>
            <li>Google handles Continue with Google.</li>
            <li>
              When you approve a gift, Zinc and the store it&apos;s bought from get what&apos;s needed to ship it: the
              recipient&apos;s name and address, your phone number, and any gift message.
            </li>
          </ul>
        </Section>

        <Section title="Deleting it">
          <ul className="list-disc pl-5">
            <li>Remove any suggestion from the person&apos;s page.</li>
            <li>
              Delete a person to remove them from your account. What was saved about them is hidden, not erased right
              away.
            </li>
            <li>
              Uninstall the extension, or sign out of it, to remove its sign-in from your browser.
            </li>
          </ul>
        </Section>

        <Section title="Asking us to erase data">
          <p>
            Write to us from{" "}
            <Link href="/feedback" className={LINK}>
              Feedback
            </Link>
            , with an email we can reply to. You don&apos;t need an account.
          </p>
          <ul className="list-disc pl-5">
            <li>
              <strong>Your account:</strong> we email the account&apos;s address to check it&apos;s you, then erase the
              account, what&apos;s saved in it, and its files for good.
            </li>
            <li>
              <strong>A person you added:</strong> we email your account&apos;s address to check, then erase them, their
              gift history and their files from your account.
            </li>
            <li>
              <strong>You, in someone else&apos;s account:</strong> people can be saved under any name, so we can only
              look for what you tell us, such as your name, birthday or address, and we may not find everything. If
              it&apos;s clearly you, we erase it and tell the person who saved it. We won&apos;t tell you who that was.
            </li>
          </ul>
          <p>
            Other people&apos;s accounts keep what they typed or copied about you, such as their entry for you, what they
            noted you like, and gifts copied from your list. Erasing your account doesn&apos;t remove that; ask for it
            too. Gift messages other people wrote are kept, as theirs.
          </p>
          <p>
            If a gift is being ordered or is on its way, we wait until that&apos;s finished. If you claimed a gift on
            someone&apos;s list, we take your name off and leave the gift marked as taken. We keep a record that something
            was erased, when, and why, without names or other details.
          </p>
          <p>
            Some copies we can&apos;t erase: emails already delivered, our email provider&apos;s copies, server and sign-in
            logs, any backups, what Zinc, the store and the other services keep, and anything someone saved
            outside {APP_NAME}.
          </p>
        </Section>

        <Section title="Questions">
          <p>
            {APP_NAME} is made by two people. Ask us anything through{" "}
            <Link href="/feedback" className={LINK}>
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
