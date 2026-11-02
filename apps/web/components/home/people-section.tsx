import Link from "next/link";
import { Button } from "@/components/ui/button";
import { todayForRequest } from "@/lib/today";
import { listPeople } from "@/modules/concierge";
import { PersonCard } from "./person-card";

// Home's People section. If the concierge can't be read, only this section
// says so; "My list" still works (products stay separable, T19).
export async function PeopleSection() {
  let people;
  try {
    people = await listPeople(await todayForRequest());
  } catch (error) {
    console.error("people not loaded", error);
    return <p className="text-[15px] text-muted-foreground">We couldn&apos;t load your people. Refresh to try again.</p>;
  }
  // Adding by hand, or bringing them in from Google Contacts (ALL-24).
  const add = (
    <div className="flex flex-wrap gap-2">
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
        <p className="text-[15px] text-muted-foreground">
          Add the people you buy for, and we&apos;ll suggest gifts before each birthday and holiday.
        </p>
        {add}
      </>
    );
  }
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {people.map((person) => (
          <PersonCard key={person.id} person={person} />
        ))}
      </div>
      {add}
    </>
  );
}
