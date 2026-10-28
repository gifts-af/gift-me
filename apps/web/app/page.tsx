import { ChevronRight, Gift } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Account } from "@/components/app-shell/account";
import { PageFrame } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { getMyListSummary } from "@/modules/lists";

// Home: the one front door after sign-in (T29). "My list" first, then
// "People" (the concierge). proxy.ts sends signed-out visitors to sign in.
export default function Home() {
  return (
    <>
      <TopBar links current="people" wide account={<Account />} />
      <PageFrame wide>
        <Suspense fallback={<ListCard title="My list" subtitle="Loading…" />}>
          <MyListCard />
        </Suspense>
        <section aria-labelledby="people-heading" className="flex flex-col gap-3">
          <h2 id="people-heading" className="text-[17px] font-semibold">
            People
          </h2>
          {/* ALL-21 fills this with people cards in a grid
              (grid gap-3 md:grid-cols-2 lg:grid-cols-3) and adds "Add someone". */}
          <p className="text-[15px] text-muted-foreground">
            Add the people you buy for, and we&apos;ll suggest gifts before each birthday and holiday.
          </p>
        </section>
      </PageFrame>
    </>
  );
}

async function MyListCard() {
  const summary = await getMyListSummary();
  return summary ? (
    <ListCard title="My list" subtitle={summary.count === 1 ? "1 gift" : `${summary.count} gifts`} />
  ) : (
    <ListCard title="Start your wish list" subtitle="Add gifts you'd like and share the link" />
  );
}

function ListCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Link
      href="/lists"
      className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 hover:border-primary/40 sm:max-w-md"
    >
      <span className="grid size-14 flex-none place-items-center rounded-md bg-muted text-muted-foreground">
        <Gift className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
