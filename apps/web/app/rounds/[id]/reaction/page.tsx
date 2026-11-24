import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { RATINGS, type Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { APP_NAME } from "@/lib/brand";
import { OCCASION_NAMES, shortDate } from "@/lib/occasion-format";
import { createClient } from "@/lib/supabase/server";
import { roundDbDeps } from "@/lib/wiring";
import { reactionView, roundAccess } from "@/modules/concierge";
import { OtherAccount } from "../../access";
import { saveReactionAction } from "../../actions";
import { ReactionForm } from "./reaction-form";

// How a round's gifts went over, from the email's answer links, the round screen or the person's
// past gifts. Loading only reads, whatever the link says (email scanners open links): an answer is
// saved by the page's own Save. Signed-out visitors are sent to sign in by proxy.ts, which brings
// them back with the path and query.
export const metadata: Metadata = {
  title: APP_NAME,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Params = Promise<{ id: string }>;
type Search = Promise<{ gift?: string | string[]; r?: string | string[] }>;

export default function ReactionPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <Loaded params={params} searchParams={searchParams} />
        </Suspense>
      </PageFrame>
    </>
  );
}

async function Loaded({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, { gift, r }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const userId = (await supabase.auth.getClaims()).data?.claims?.sub;
  if (!userId) notFound();
  // The only service-role read: whose round it is, and nothing more (T80).
  const access = await roundAccess(id, userId, roundDbDeps(new Date()));
  if (access === "missing") notFound();
  if (access === "other") return <OtherAccount />;

  const view = await reactionView(id, supabase as unknown as SupabaseClient<Database>, new Date());
  if (!view) notFound();
  const { round, gifts, closed } = view;
  const name = round.personName;

  // A link that names no gift of this round, or no real answer, opens the page as it is.
  const linked = gifts.find((g) => g.orderId === gift);
  const opened = linked ? { orderId: linked.orderId, rating: RATINGS.find((x) => x === r) ?? null } : null;

  const answers = name ? `How did ${name} like ${gifts.length > 1 ? "them" : "it"}?` : "How did it go?";
  const occasion = OCCASION_NAMES[round.occasionKind as keyof typeof OCCASION_NAMES] ?? "Occasion";
  const date = shortDate(round.occasionDate);
  const nothing =
    closed === "off"
      ? "Not available right now."
      : closed === "too_early"
        ? `You can say how it went from ${date}.`
        : gifts.length === 0
          ? "No gift has arrived for this occasion."
          : null;

  return (
    <>
      <BackLink href={`/rounds/${round.id}`} label={name ? `Gift for ${name}` : "Gift"} />
      <PageTitle>{nothing === null ? answers : name ? `Gift for ${name}` : "Gift"}</PageTitle>
      <p className="-mt-4 text-[13px] text-muted-foreground">{`${occasion} ${date}`}</p>
      {nothing !== null ? (
        <p role="status" className="rounded-xl border border-border p-3 text-[15px]">
          {nothing}
        </p>
      ) : (
        <ReactionForm
          // Next keeps this page's state, so another answer link starts fresh.
          key={`${opened?.orderId}:${opened?.rating}`}
          gifts={gifts}
          noteMaxChars={view.noteMaxChars}
          opened={opened}
          personName={name}
          personId={round.personId}
          saveAction={saveReactionAction}
        />
      )}
    </>
  );
}
