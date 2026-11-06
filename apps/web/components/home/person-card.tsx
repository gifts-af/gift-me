import { ChevronRight, ListChecks, Sparkles } from "lucide-react";
import Link from "next/link";
import { OCCASION_NAMES, shortDate } from "@/components/occasion-format";
import { PersonAvatar } from "@/components/person-avatar";
import type { PersonCard as Card } from "@/modules/concierge";

/** One person on Give: who, what's next, and where their ideas come from. */
export function PersonCard({ person }: { person: Card }) {
  const Source = person.keepsList ? ListChecks : Sparkles;
  return (
    <div className="relative flex items-center gap-3 rounded-lg border bg-card p-3 hover:border-primary/40">
      <PersonAvatar name={person.name} photoUrl={person.photoUrl} size={56} decorative />
      <div className="min-w-0 flex-1">
        <Link
          href={`/people/${person.id}`}
          className="block truncate text-[15px] font-semibold after:absolute after:inset-0 after:content-['']"
        >
          {person.name}
        </Link>
        {person.next && (
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {OCCASION_NAMES[person.next.kind]} · {shortDate(person.next.date)}
          </p>
        )}
        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Source className="size-3.5" aria-hidden="true" />
          {person.keepsList ? "Their own list" : "We suggest ideas"}
        </p>
        {!person.hasBirthday && (
          <Link
            href={`/people/${person.id}#birthday`}
            className="relative z-10 mt-1 inline-flex min-h-11 items-center text-[13px] font-semibold text-primary underline-offset-2 hover:underline"
          >
            Add birthday
          </Link>
        )}
      </div>
      <ChevronRight className="size-5 flex-none text-muted-foreground" aria-hidden="true" />
    </div>
  );
}
