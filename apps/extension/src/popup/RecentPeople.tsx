import type { Person } from "./PeopleScreen";

// Under the product card: the 3 people saved for most recently and "Someone
// else…" (AC-11). Each opens the full list (with that person picked), so a
// mis-tap never saves.
export function RecentPeople({
  people,
  disabled,
  onPick,
  onSomeoneElse,
}: {
  people: Person[];
  /** While an add is in flight. */
  disabled: boolean;
  onPick: (person: Person) => void;
  onSomeoneElse: () => void;
}) {
  return (
    <>
      <div className="or-divider">or save it for someone</div>
      <div className="flex flex-wrap gap-2">
        {people.map((person) => (
          <button key={person.id} type="button" className="chip" disabled={disabled} onClick={() => onPick(person)}>
            {person.name}
          </button>
        ))}
        <button type="button" className="chip chip-more" disabled={disabled} onClick={onSomeoneElse}>
          Someone else…
        </button>
      </div>
    </>
  );
}
