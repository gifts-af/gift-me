import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { readAccess } from "@/components/concierge-gate";
import { createClient } from "@/lib/supabase/server";
import { todayForRequest } from "@/lib/today";
import { getPerson, getProfile, type Db } from "@/modules/concierge";
import {
  addFactAction,
  deleteFactAction,
  editFactAction,
  readCapturesAction,
  setFactActiveAction,
} from "../../actions";
import { WhatWeKnow } from "../what-we-know";
import { AddFact } from "./add-fact";

// For "Read them now" (readCapturesAction), which reads unread captures with AI one after
// another and can run long. 300 s is the most Vercel's Fluid compute allows on our plan.
// Next needs a literal here.
export const maxDuration = 300;

// What we know about a person (T71): a box to add something, the questions while any are
// open, then every fact by kind, each opening in place. Opened from the What we know row on
// their page. Signed-out visitors are sent to sign in by proxy.ts.
export default function KnowPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <TopBar>
        <AppNav current="give" />
      </TopBar>
      <PageFrame>
        <Suspense fallback={<p className="text-[15px] text-muted-foreground">Loading…</p>}>
          <Loaded params={params} />
        </Suspense>
      </PageFrame>
    </>
  );
}

async function Loaded({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const userId = (await supabase.auth.getClaims()).data?.claims?.sub;
  if (!userId) redirect("/");
  const person = await getPerson(id, await todayForRequest());
  if (!person) notFound();
  const [profile, access] = await Promise.all([
    getProfile(supabase as unknown as Db, person.id, person.keepsList),
    readAccess(),
  ]);
  const base = `/people/${person.id}`;

  return (
    <>
      <BackLink href={base} label={person.name} />
      <PageTitle>What we know</PageTitle>
      {/* An unread access (null) hides the "saved for later" line rather than showing it to someone who may have access. */}
      <AddFact personId={person.id} action={addFactAction} hasAccess={access ? access.access : true} />
      {profile.openCount > 0 && (
        <p className="-my-3 text-[15px]">
          <Link
            href={`${base}/questions`}
            className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline"
          >
            {profile.groups.length === 0 ? "Answer a few questions" : "Answer more questions"}
          </Link>
        </p>
      )}
      <WhatWeKnow
        personId={person.id}
        name={person.name}
        knowledge={profile}
        hasAccess={access?.access ?? false}
        editAction={editFactAction}
        setActiveAction={setFactActiveAction}
        deleteAction={deleteFactAction}
        readAction={readCapturesAction}
      />
    </>
  );
}
