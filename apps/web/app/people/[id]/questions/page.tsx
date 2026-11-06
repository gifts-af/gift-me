import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "@/components/app-shell/app-nav";
import { BackLink, PageFrame, PageTitle } from "@/components/app-shell/page-frame";
import { TopBar } from "@/components/app-shell/top-bar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { todayForRequest } from "@/lib/today";
import { getOpenQuestions, getPerson, type Db } from "@/modules/concierge";
import { answerQuestionsAction, skipQuestionAction } from "../../actions";
import { QuestionForm } from "./question-form";

// The guided questions form (ALL-26), also where an email's link lands (§6.7).
// Signed-out visitors are sent to sign in by proxy.ts.
export default function QuestionsPage({ params }: { params: Promise<{ id: string }> }) {
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
  const person = await getPerson(id, await todayForRequest());
  if (!person) notFound();
  const questions = await getOpenQuestions((await createClient()) as unknown as Db, person.id);

  return (
    <>
      <BackLink href={`/people/${person.id}`} label={person.name} />
      <PageTitle>A few questions about {person.name}</PageTitle>
      {questions.length > 0 ? (
        <QuestionForm
          personId={person.id}
          name={person.name}
          questions={questions}
          answerAction={answerQuestionsAction}
          skipAction={skipQuestionAction}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[15px] text-muted-foreground">No questions right now.</p>
          <Button asChild>
            <Link href={`/people/${person.id}`}>Back to {person.name}</Link>
          </Button>
        </div>
      )}
    </>
  );
}
