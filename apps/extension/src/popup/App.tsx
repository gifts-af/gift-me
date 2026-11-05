import { useEffect, useState } from "react";
import { captureReadNotice } from "@gifts-af/core";
import { signOut } from "../lib/auth";
import { config } from "../lib/config";
import { getSupabase } from "../lib/supabase";
import { collectPage, ScreenshotTooLargeError } from "../lib/page";
import { retryExtraction, uploadCapture, type CaptureInput, type Extraction } from "../lib/upload";
import { AddPerson } from "./AddPerson";
import { PersonPicker, type Person } from "./PersonPicker";
import { CaptureForm } from "./CaptureForm";
import { Learned } from "./Learned";
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
  const { people, textMax, screenshotMaxBytes, paidFeatures, readEstimateCents, tabId, capturable } = loaded;
  const [selected, setSelected] = useState<Person | null>(null);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The collected page, kept so Try again resends it rather than re-reading the tab.
  const [pending, setPending] = useState<CaptureInput | null>(null);
  // The saved capture and what the web app learned from it (ALL-25).
  const [saved, setSaved] = useState<{ captureId: string; person: Person; extraction: Extraction | null } | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

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
          page = await collectPage(tabId, { jpegQuality: config.jpegQuality, textMax, screenshotMaxBytes });
        } catch (err) {
          setError(err instanceof ScreenshotTooLargeError ? err.message : "Couldn't read this page. Try again.");
          return;
        }
        payload = { personId: selected.id, ...page, note: note.trim() || null };
        setPending(payload);
      }
      const { data } = await getSupabase().auth.getSession();
      if (!data.session) return onSignedOut();
      const result = await uploadCapture(data.session.access_token, payload);
      if (result.ok) {
        setSaved({ captureId: result.id, person: selected, extraction: result.extraction });
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

  async function retry() {
    if (!saved) return;
    setBusy(true);
    setRetryError(null);
    try {
      const { data } = await getSupabase().auth.getSession();
      if (!data.session) return onSignedOut();
      const result = await retryExtraction(data.session.access_token, saved.captureId);
      if (result.ok) setSaved({ ...saved, extraction: result.extraction });
      else if (result.status === 401) onSignedOut();
      else setRetryError(result.error);
    } finally {
      setBusy(false);
    }
  }

  function captureAnother() {
    setSaved(null);
    setRetryError(null);
    setSelected(null);
    setNote("");
    setError(null);
    setPending(null);
    setAdding(false);
  }

  if (saved) {
    return (
      <Learned
        personId={saved.person.id}
        name={saved.person.name}
        extraction={saved.extraction}
        paidFeatures={paidFeatures}
        readEstimateCents={readEstimateCents}
        busy={busy}
        error={retryError}
        onRetry={() => void retry()}
        onAnother={captureAnother}
      />
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
      {busy && (
        <p className="m-0 text-sm text-muted-foreground" role="status">
          Reading the page…
        </p>
      )}
      <CaptureForm
        note={note}
        onNoteChange={changeNote}
        saveLabel={selected ? `Save to ${selected.name}` : "Save"}
        moneyNotice={paidFeatures ? captureReadNotice(readEstimateCents) : null}
        canSave={selected !== null && capturable}
        busy={busy}
        error={error}
        onSave={save}
      />
    </div>
  );
}
