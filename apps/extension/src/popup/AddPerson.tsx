import { useId, useState, type FormEvent } from "react";
import { RELATIONSHIPS } from "@gifts-af/core";
import { getSupabase } from "../lib/supabase";
import type { Person } from "./PersonPicker";

// Quick add (AC-9): just a name and a relationship; details wait for the web app.
export function AddPerson({ onAdded, onCancel }: { onAdded: (person: Person) => void; onCancel?: () => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !relationship) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await getSupabase()
        .from("people")
        .insert({ name: trimmed, relationship })
        .select("id, name")
        .single();
      if (err || !data) throw err;
      onAdded(data);
    } catch {
      setError("Couldn't add them. Try again.");
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3 rounded-lg border border-border p-3" onSubmit={submit}>
      <p className="m-0 text-[15px] font-semibold">Add a person</p>
      <label className="field" htmlFor={`${id}-name`}>
        Name
        <input
          className="input"
          id={`${id}-name`}
          maxLength={120}
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field" htmlFor={`${id}-rel`}>
        Relationship
        <select
          className="input"
          id={`${id}-rel`}
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
        >
          <option value="" disabled>
            Choose one
          </option>
          {RELATIONSHIPS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button className="btn-secondary" type="submit" disabled={busy || !name.trim() || !relationship}>
          {busy ? "Adding…" : "Add"}
        </button>
        {onCancel && (
          <button className="btn-link" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
