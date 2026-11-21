import { useEffect, useState, type ReactNode } from "react";
import { captureReadNotice } from "@gifts-af/core";
import { signOut } from "../lib/auth";
import { config } from "../lib/config";
import { getSupabase } from "../lib/supabase";
import { collectPage, ScreenshotTooLargeError, type ShownProduct } from "../lib/page";
import { cropPhoto } from "../lib/photo";
import { addToMyList, retryExtraction, uploadCapture, type AddOutcome, type CaptureInput, type Extraction } from "../lib/upload";
import { AddResult } from "./AddResult";
import { Learned } from "./Learned";
import { PeopleScreen, type Person } from "./PeopleScreen";
import {
  CropView,
  initialName,
  initialPrice,
  parsePrice,
  photoCandidates,
  ProductCard,
  storeLabel,
  useObjectUrl,
} from "./ProductCard";
import { RecentPeople } from "./RecentPeople";
import { loadPopup, type LoadResult, type Loaded } from "./load";

type View = { kind: "loading" } | LoadResult;

// The popup: sign in; on a product page, add it to my list or save it for
// someone; on any other page, save it for someone (ALL-78).
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
  // Off while an add or save is in flight, so its answer can't land after signing out.
  const signOutButton = (disabled = false) => (
    <button className="btn-link text-sm text-primary" type="button" disabled={disabled} onClick={handleSignOut}>
      Sign out
    </button>
  );

  return (
    <main className="flex w-[360px] flex-col">
      {view.kind === "ready" ? (
        <Capture
          loaded={view}
          signOutButton={signOutButton}
          onPeopleChange={(people) => setView({ ...view, people })}
          onSignedOut={() => setView({ kind: "signedOut" })}
        />
      ) : (
        <>
          <Bar title="GiftsAF" right={view.kind === "error" ? signOutButton() : undefined} />
          {view.kind === "loading" && <p className="m-0 p-4 text-sm text-muted-foreground">Loading…</p>}
          {view.kind === "signedOut" && <SignIn />}
          {view.kind === "error" && (
            <p role="alert" className="m-0 p-4 text-sm text-destructive">
              Something went wrong. Close GiftsAF and open it again.
            </p>
          )}
        </>
      )}
    </main>
  );
}

function Bar({ title, left, right }: { title: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex min-h-12 flex-none items-center justify-between gap-2 border-b border-border px-4 py-1.5">
      {left}
      <span className="text-[15px] font-bold">{title}</span>
      {/* Keeps the title centred between Back and nothing. */}
      {right ?? (left ? <span className="w-11" aria-hidden="true" /> : null)}
    </header>
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

const NO_PRODUCT = "No product on this page, so there's nothing to add to your list. You can still save it for someone.";

function Capture({
  loaded,
  signOutButton,
  onPeopleChange,
  onSignedOut,
}: {
  loaded: Loaded;
  signOutButton: (disabled: boolean) => ReactNode;
  onPeopleChange: (people: Person[]) => void;
  onSignedOut: () => void;
}) {
  const { people, recentPeople, recentCount, textMax, screenshotMaxBytes, paidFeatures, readEstimateCents, tabId, capturable, page } =
    loaded;
  const product = page?.product?.isProduct ? (page as ShownProduct) : null;

  // The full people list over the card, opened by "Someone else…" (AC-13).
  const [peopleOpen, setPeopleOpen] = useState(false);
  // The card's edits live here, so they survive the people screen (AC-13).
  const [photoIndex, setPhotoIndex] = useState(0);
  const [name, setName] = useState(() => (product ? initialName(product) : ""));
  const [price, setPrice] = useState(() => (product ? initialPrice(product) : ""));
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ result: AddOutcome; gift: { name: string; priceCents: number } } | null>(null);

  const [selected, setSelected] = useState<Person | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The collected page, kept so Try again resends it rather than re-reading the tab.
  const [pending, setPending] = useState<CaptureInput | null>(null);
  // The saved capture and what the web app learned from it (ALL-25).
  const [saved, setSaved] = useState<{ captureId: string; person: Person; extraction: Extraction | null } | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const moneyNotice = paidFeatures ? captureReadNotice(readEstimateCents) : null;
  // While an add or save is in flight, nothing that leaves the screen works, so
  // its answer always lands on the screen that asked (store review).
  const inFlight = busy || addBusy;
  const signOutNode = signOutButton(inFlight);

  function select(person: Person) {
    setSelected(person);
    setPending(null);
    setError(null);
  }

  function changeNote(value: string) {
    setNote(value);
    setPending(null);
  }

  function personAdded(person: Person) {
    onPeopleChange([...people, person].sort((a, b) => a.name.localeCompare(b.name)));
    select(person);
  }

  async function save(person: Person, noteText: string) {
    if (!capturable || tabId === null) return;
    setBusy(true);
    setError(null);
    try {
      const noteValue = noteText.trim() || null;
      // Reused only for the same person and note (a failed save's Try again).
      let payload = pending?.personId === person.id && pending.note === noteValue ? pending : null;
      if (!payload) {
        let collected;
        try {
          // A fresh JPEG capture: the route takes JPEG only, and the screenshot
          // read on open is a PNG for cropping.
          collected = await collectPage(tabId, { jpegQuality: config.jpegQuality, textMax, screenshotMaxBytes });
        } catch (err) {
          setError(err instanceof ScreenshotTooLargeError ? err.message : "Couldn't read this page. Try again.");
          return;
        }
        payload = { personId: person.id, ...collected, note: noteValue };
        setPending(payload);
      }
      const { data } = await getSupabase().auth.getSession();
      if (!data.session) return onSignedOut();
      const result = await uploadCapture(data.session.access_token, payload);
      if (result.ok) {
        setSaved({ captureId: result.id, person, extraction: result.extraction });
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

  // A recent person opens the full list with them picked, so the note and
  // "Save to {name}" are right there and one mis-tap can't save (AC-11).
  function openPeople(person: Person | null) {
    if (person && selected?.id !== person.id) select(person);
    setError(null);
    setPeopleOpen(true);
  }

  async function add(confirmLikely: boolean) {
    const priceCents = parsePrice(price);
    const trimmed = name.trim();
    if (!product || priceCents === null || !trimmed) return;
    setAddBusy(true);
    setAddError(null);
    try {
      const box = photoCandidates(product)[photoIndex];
      let photo: Blob | null = null;
      if (box && product.screenshot && product.scale) {
        try {
          photo = await cropPhoto(product.screenshot, box, product.scale, loaded.photoWidthPx, loaded.photoJpegQuality);
        } catch {
          setAddError("Couldn't use that photo. Try again.");
          return;
        }
      }
      const { data } = await getSupabase().auth.getSession();
      if (!data.session) return onSignedOut();
      const result = await addToMyList(data.session.access_token, {
        name: trimmed,
        priceCents,
        pageUrl: product.pageUrl,
        canonicalUrl: product.product.canonicalUrl,
        productId: product.product.productId,
        photo,
        confirmLikely,
      });
      if (result.ok) setAdded({ result, gift: { name: trimmed, priceCents } });
      else if (result.status === 401) onSignedOut();
      else {
        setAdded(null);
        setAddError(result.error);
      }
    } finally {
      setAddBusy(false);
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
    setPeopleOpen(false);
  }

  if (saved) {
    return (
      <>
        <Bar title="Capture for…" right={signOutNode} />
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
      </>
    );
  }

  if (added) {
    return (
      <>
        <Bar title="GiftsAF" right={signOutNode} />
        <AddResult
          result={added.result}
          gift={added.gift}
          busy={addBusy}
          onAddAnyway={() => void add(true)}
          onDontAdd={() => setAdded(null)}
          onDone={() => window.close()}
        />
      </>
    );
  }

  if (product && !peopleOpen) {
    return (
      <>
        <Bar title="GiftsAF" right={signOutNode} />
        <div className="flex flex-col gap-3.5 p-4">
          <ProductCard
            page={product}
            photoIndex={photoIndex}
            onPhotoIndex={setPhotoIndex}
            name={name}
            onName={setName}
            price={price}
            onPrice={setPrice}
            busy={addBusy}
            onAdd={() => void add(false)}
          />
          {addError && (
            <p role="alert" className="m-0 text-sm text-destructive">
              {addError}
            </p>
          )}
          <RecentPeople people={recentPeople} disabled={inFlight} onPick={openPeople} onSomeoneElse={() => openPeople(null)} />
        </div>
      </>
    );
  }

  // The full list: from "Someone else…", or on a page with no product (AC-10, AC-12).
  const top = product ? (
    <ProductReminder page={product} photoIndex={photoIndex} name={name} />
  ) : (
    <p className="m-0 rounded-lg bg-muted px-3 py-2.5 text-sm">{capturable ? NO_PRODUCT : "This page can't be captured."}</p>
  );
  return (
    <div className="flex h-[520px] flex-col">
      {product ? (
        <Bar
          title="Save for someone"
          left={
            <button className="btn-link text-sm text-primary" type="button" disabled={inFlight} onClick={() => {
                setError(null);
                setPeopleOpen(false);
              }}
            >
              ‹ Back
            </button>
          }
        />
      ) : (
        <Bar title="GiftsAF" right={signOutNode} />
      )}
      <PeopleScreen
        top={top}
        people={people}
        recent={recentPeople.slice(0, recentCount)}
        selectedId={selected?.id ?? null}
        onSelect={select}
        onAdded={personAdded}
        autoFocusSearch={product !== null}
        note={note}
        onNoteChange={changeNote}
        saveLabel={selected ? `Save to ${selected.name}` : "Save"}
        moneyNotice={moneyNotice}
        canSave={selected !== null && capturable}
        busy={busy}
        error={error}
        onSave={() => selected && void save(selected, note)}
      />
    </div>
  );
}

// "What you're saving" at the top of the people screen: the chosen photo, the name and the store.
function ProductReminder({ page, photoIndex, name }: { page: ShownProduct; photoIndex: number; name: string }) {
  const shotUrl = useObjectUrl(page.screenshot);
  const box = photoCandidates(page)[photoIndex];
  return (
    <div className="flex min-w-0 items-center gap-2.5 text-sm font-semibold">
      <span className="grid h-10 w-10 flex-none place-items-center overflow-hidden rounded-md bg-muted">
        {box && <CropView shotUrl={shotUrl} box={box} viewportWidth={page.viewportWidth} size={40} />}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="block">{name}</span>
        <small className="block text-xs font-normal text-muted-foreground">{storeLabel(page.pageUrl)}</small>
      </span>
    </div>
  );
}
