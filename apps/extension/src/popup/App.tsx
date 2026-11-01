import { useEffect, useState } from "react";
import { signOut } from "../lib/auth";
import { config } from "../lib/config";
import { getSupabase } from "../lib/supabase";
import { collectPage } from "../lib/page";
import { uploadCapture, type CaptureInput } from "../lib/upload";
import { AddPerson } from "./AddPerson";
import { PersonPicker, type Person } from "./PersonPicker";
import { CaptureForm } from "./CaptureForm";
import { loadPopup, type LoadResult, type Loaded } from "./load";

type View = { kind: "loading" } | LoadResult;

// The popup: sign in, or pick a person and save the current page to them.
export function App() {
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    loadPopup().then((result) => live && setView(result));
    return () => {
      live = false;
    };
  }, []);

  async function handleSignOut() {
    await signOut();
    setView({ kind: "signedOut" });
  }

  return (
    <main className="flex w-[360px] flex-col">
      <header className="flex min-h-12 items-center justify-between gap-2 border-b border-border px-4 py-1.5">
        <span className="text-[15px] font-bold">{view.kind === "signedOut" ? "GiftsAF" : "Capture for…"}</span>
        {(view.kind === "ready" || view.kind === "error") && (
          <button className="btn-link text-sm" type="button" onClick={handleSignOut}>
            Sign out
          </button>
        )}
      </header>
      {view.kind === "loading" && <p className="m-0 p-4 text-sm text-muted-foreground">Loading…</p>}
      {view.kind === "signedOut" && <SignIn />}
      {view.kind === "error" && (
        <p role="alert" className="m-0 p-4 text-sm text-destructive">
          Something went wrong. Close GiftsAF and open it again.
        </p>
      )}
      {view.kind === "ready" && (
        <Capture
          loaded={view}
          onPeopleChange={(people) => setView({ ...view, people })}
          onSignedOut={() => setView({ kind: "signedOut" })}
        />
      )}
    </main>
  );
}

function SignIn() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="m-0 text-[15px]">Sign in to save pages for the people you shop for.</p>
      <button
        className="btn-primary"
        type="button"
        onClick={() => chrome.tabs.create({ url: `${config.appOrigin}/extension/connect` })}
      >
        Sign in
      </button>
    </div>
  );
}

function Capture({
  loaded,
  onPeopleChange,
  onSignedOut,
}: {
  loaded: Loaded;
  onPeopleChange: (people: Person[]) => void;
  onSignedOut: () => void;
}) {
  const { people, textMax, tabId, capturable } = loaded;
  const [selected, setSelected] = useState<Person | null>(null);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The collected page, kept so Try again resends it rather than re-reading the tab.
  const [pending, setPending] = useState<CaptureInput | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);

  function select(person: Person) {
    setSelected(person);
    setPending(null);
  }

  function changeNote(value: string) {
    setNote(value);
    setPending(null);
  }

  function added(person: Person) {
    onPeopleChange([...people, person].sort((a, b) => a.name.localeCompare(b.name)));
    setAdding(false);
    select(person);
  }

  async function save() {
    if (!selected || !capturable || tabId === null) return;
    setBusy(true);
    setError(null);
    try {
      let payload = pending;
      if (!payload) {
        let page;
        try {
          page = await collectPage(tabId, { jpegQuality: config.jpegQuality, textMax });
        } catch {
          setError("Couldn't read this page. Try again.");
          return;
        }
        payload = { personId: selected.id, ...page, note: note.trim() || null };
        setPending(payload);
      }
      const { data } = await getSupabase().auth.getSession();
      if (!data.session) return onSignedOut();
      const result = await uploadCapture(data.session.access_token, payload);
      if (result.ok) {
        setSavedTo(selected.name);
        setPending(null);
      } else if (result.status === 401) {
        onSignedOut();
      } else {
        setError(result.error);
      }
    } finally {
      setBusy(false);
    }
  }

  function captureAnother() {
    setSavedTo(null);
    setSelected(null);
    setNote("");
    setError(null);
    setPending(null);
    setAdding(false);
  }

  if (savedTo) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <span className="rounded-full bg-success-soft px-2.5 py-1 text-[13px] font-semibold text-success">Saved</span>
        <p className="m-0" role="status">
          Saved to {savedTo}. We'll show you what we learned.
        </p>
        <button className="btn-link" type="button" onClick={captureAnother}>
          Capture another
        </button>
      </div>
    );
  }

  const showAdd = adding || people.length === 0;
  return (
    <div className="flex flex-col gap-4 p-4">
      {!capturable && <p className="m-0 rounded-lg bg-muted p-3 text-sm">This page can't be captured.</p>}
      {people.length > 0 && <PersonPicker people={people} selectedId={selected?.id ?? null} onSelect={select} />}
      {showAdd ? (
        <AddPerson onAdded={added} onCancel={people.length > 0 ? () => setAdding(false) : undefined} />
      ) : (
        <button className="btn-link self-start" type="button" onClick={() => setAdding(true)}>
          Add a person
        </button>
      )}
      <CaptureForm
        note={note}
        onNoteChange={changeNote}
        saveLabel={selected ? `Save to ${selected.name}` : "Save"}
        canSave={selected !== null && capturable}
        busy={busy}
        error={error}
        onSave={save}
      />
    </div>
  );
}
