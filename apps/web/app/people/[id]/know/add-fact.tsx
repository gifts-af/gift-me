"use client";

import { useId, useState } from "react";
import { CATEGORY_GROUPS, type FactCategory } from "@gifts-af/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useHydrated } from "@/lib/use-hydrated";
import type { SaveResult } from "@/modules/concierge";

// "Add something" at the top of What we know: the buyer's own words and a kind, saved as a fact
// "You told us". The words live in state, not the form: React clears a form after its action, and
// refused words must stay put. Most of what people add is something the person likes.

type Action = (previous: null, formData: FormData) => Promise<SaveResult>;

const FIRST_KIND: FactCategory = "interest";

export function AddFact({ personId, action }: { personId: string; /** `addFactAction` */ action: Action }) {
  const id = useId();
  const hydrated = useHydrated();
  const [value, setValue] = useState("");
  const [category, setCategory] = useState<FactCategory>(FIRST_KIND);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setAdded(false);
    if (!value.trim()) {
      setError("Type something first.");
      return;
    }
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("personId", personId);
    form.set("value", value);
    form.set("category", category);
    let result: SaveResult;
    try {
      result = await action(null, form);
    } catch {
      result = { ok: false, error: "That didn't save. Try again." };
    }
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setValue("");
    setCategory(FIRST_KIND);
    setAdded(true);
  }

  return (
    <form onSubmit={(e) => void add(e)} className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-value`}>Add something</Label>
        <Input
          id={`${id}-value`}
          value={value}
          placeholder="Loves pottery, size M, allergic to nuts…"
          onChange={(e) => {
            setValue(e.target.value);
            setAdded(false);
          }}
          aria-invalid={error ? true : undefined}
        />
      </div>
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={`${id}-category`}>Kind</Label>
          <NativeSelect id={`${id}-category`} value={category} onChange={(e) => setCategory(e.target.value as FactCategory)}>
            {CATEGORY_GROUPS.map((g) => (
              <option key={g.category} value={g.category}>
                {g.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" disabled={busy || !hydrated}>
          Add
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-[13px] text-success">
        {added ? "Added" : ""}
      </p>
    </form>
  );
}
