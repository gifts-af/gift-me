import { useState, type ReactNode } from "react";
import { AddPerson } from "./AddPerson";
import { CaptureForm } from "./CaptureForm";

export type Person = { id: string; name: string };

// The full people list with the whole popup to itself (AC-10, AC-12): `top`
// and search pinned at the top, the note and Save pinned at the bottom, and
// only the names scroll between them. Recent people come first.
export function PeopleScreen({
  top,
  people,
  recent,
  selectedId,
  onSelect,
  onAdded,
  autoFocusSearch,
  note,
  onNoteChange,
  saveLabel,
  moneyNotice,
  canSave,
  busy,
  error,
  onSave,
}: {
  /** What sits above search: the product reminder, or why there's nothing to add. */
  top?: ReactNode;
  people: Person[];
  recent: Person[];
  selectedId: string | null;
  onSelect: (person: Person) => void;
  onAdded: (person: Person) => void;
  autoFocusSearch: boolean;
  note: string;
  onNoteChange: (note: string) => void;
  saveLabel: string;
  moneyNotice: string | null;
  canSave: boolean;
  busy: boolean;
  error: string | null;
  onSave: () => void;
}) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const needle = query.trim().toLowerCase();
  const recentIds = new Set(recent.map((p) => p.id));
  const ordered = [...recent.filter((r) => people.some((p) => p.id === r.id)), ...people.filter((p) => !recentIds.has(p.id))];
  const shown = needle ? ordered.filter((p) => p.name.toLowerCase().includes(needle)) : ordered;
  const showAdd = adding || people.length === 0;

  function added(person: Person) {
    setAdding(false);
    setQuery("");
    onAdded(person);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2.5 border-b border-border px-4 py-3">
        {top}
        {people.length > 0 && (
          <input
            className="input"
            type="search"
            placeholder="Search people"
            aria-label="Search people"
            autoFocus={autoFocusSearch}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>
      <div className="scroller">
        {people.length > 0 && (
          <ul aria-label="People" className="m-0 flex list-none flex-col gap-2 p-0.5">
            {shown.map((person) => (
              <li key={person.id}>
                <button type="button" className="person" aria-pressed={person.id === selectedId} onClick={() => onSelect(person)}>
                  <span className="[overflow-wrap:anywhere]">{person.name}</span>
                  {recentIds.has(person.id) && (
                    <span className="recent-tag" aria-hidden="true">
                      recent
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {people.length > 0 && shown.length === 0 && (
          <p className="m-0 text-sm text-muted-foreground">No one matches “{query.trim()}”.</p>
        )}
        {showAdd ? (
          <AddPerson onAdded={added} onCancel={people.length > 0 ? () => setAdding(false) : undefined} />
        ) : (
          <button className="btn-link self-start text-primary" type="button" onClick={() => setAdding(true)}>
            Add a person
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2.5 border-t border-border px-4 py-3">
        <CaptureForm
          note={note}
          onNoteChange={onNoteChange}
          saveLabel={saveLabel}
          moneyNotice={moneyNotice}
          canSave={canSave}
          busy={busy}
          error={error}
          onSave={onSave}
        />
      </div>
    </div>
  );
}
