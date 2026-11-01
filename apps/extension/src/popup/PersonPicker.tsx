import { useState } from "react";

export type Person = { id: string; name: string };

// One card per person; picking one selects it (aria-pressed), like the mock-up.
export function PersonPicker({
  people,
  selectedId,
  onSelect,
}: {
  people: Person[];
  selectedId: string | null;
  onSelect: (person: Person) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle ? people.filter((p) => p.name.toLowerCase().includes(needle)) : people;

  return (
    <div className="flex flex-col gap-2">
      <input
        className="input"
        type="search"
        placeholder="Search people"
        aria-label="Search people"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="m-0 flex max-h-64 list-none flex-col gap-2 overflow-y-auto p-0.5">
        {shown.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              className="person"
              aria-pressed={person.id === selectedId}
              onClick={() => onSelect(person)}
            >
              <span className="grow text-[15px] font-semibold [overflow-wrap:anywhere]">{person.name}</span>
              <span className="check" aria-hidden="true">
                <CheckIcon />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="m-0 text-sm text-muted-foreground">No one matches “{query.trim()}”.</p>}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
