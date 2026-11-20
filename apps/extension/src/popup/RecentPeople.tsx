import type { Person } from "./PeopleScreen";

// Under the product card: the 3 people saved for most recently, one tap each,
// and "Someone else…" for the full list (AC-11).
export function RecentPeople({
  people,
  busy,
  onPick,
  onSomeoneElse,
}: {
  people: Person[];
  busy: boolean;
  onPick: (person: Person) => void;
  onSomeoneElse: () => void;
}) {
  return (
    <>
      <div className="or-divider">or save it for someone</div>
      <div className="flex flex-wrap gap-2">
        {people.map((person) => (
          <button key={person.id} type="button" className="chip" disabled={busy} onClick={() => onPick(person)}>
            {person.name}
          </button>
        ))}
        <button type="button" className="chip chip-more" disabled={busy} onClick={onSomeoneElse}>
          Someone else…
        </button>
      </div>
    </>
  );
}
