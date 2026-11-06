import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Button } from "@/components/ui/button";
import { todayForRequest } from "@/lib/today";
import { listPeople } from "@/modules/concierge";
import { PersonCard } from "./person-card";

// Give's people, as children of the page's grid. If the concierge can't be
// read, only this says so; the You card still works (products stay separable, T19).
export async function PeopleSection() {
  let people;
  try {
    people = await listPeople(await todayForRequest());
  } catch (error) {
    unstable_rethrow(error); // Next's end-of-prerender signal isn't a failure (ALL-87).
    console.error("people not loaded", error);
    return <p className="col-span-full text-[15px] text-muted-foreground">We couldn&apos;t load your people. Refresh to try again.</p>;
  }
  // Adding by hand, or bringing them in from Google Contacts (ALL-24).
  const add = (
    <div className="col-span-full flex flex-wrap gap-2">
      <Button asChild variant="outline">
        <Link href="/people/new">Add someone you buy for</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/people/import">Import from Google</Link>
      </Button>
    </div>
  );
  if (people.length === 0) {
    return (
      <>
        <p className="col-span-full text-[15px] text-muted-foreground">
          Add the people you buy for, and we&apos;ll suggest gifts before each birthday and holiday.
        </p>
        {add}
      </>
    );
  }
  return (
    <>
      {people.map((person) => (
        <PersonCard key={person.id} person={person} />
      ))}
      {add}
    </>
  );
}
