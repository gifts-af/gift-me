import { CAPTURE_READ_OFF, captureReadNotice, factLine } from "@gifts-af/core";
import { config } from "../lib/config";
import type { Extraction } from "../lib/upload";
import { SuccessBanner } from "./SuccessBanner";

// After a capture is saved: "✓ Saved to {name}" first, then what happened to
// the read (ALL-25, D47, ALL-78 mock-ups), then the person's profile and
// Capture another. `extraction` is null when the server didn't say (an older web app).
export function Learned({
  personId,
  name,
  extraction,
  paidFeatures,
  readEstimateCents,
  busy,
  error,
  onRetry,
  onAnother,
}: {
  personId: string;
  name: string;
  extraction: Extraction | null;
  paidFeatures: boolean;
  readEstimateCents: number;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onAnother: () => void;
}) {
  const facts = extraction?.facts ?? [];
  return (
    <div className="flex flex-col gap-3.5 p-4">
      <SuccessBanner title={`Saved to ${name}`} detail={busy ? "Reading the page…" : undefined} />
      {busy || extraction === null ? null : extraction.status === "pending" && !paidFeatures ? (
        <p role="note" className="note">
          <b>Not read yet</b>
          {CAPTURE_READ_OFF} The page is kept on {name}'s profile.
        </p>
      ) : extraction.status === "pending" ? (
        <p className="m-0 text-sm">We'll read it shortly. What we learn shows on {name}'s profile.</p>
      ) : extraction.status === "failed" ? (
        <>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>We couldn't read this page.</span>
            <button className="btn-link shrink-0 text-primary" type="button" onClick={onRetry}>
              Try again
            </button>
          </div>
          <p role="note" className="note">
            {captureReadNotice(readEstimateCents)}
          </p>
        </>
      ) : facts.length === 0 ? (
        <p className="m-0 text-sm">Nothing new to learn from this page. It's kept on {name}'s profile.</p>
      ) : (
        <section className="flex flex-col gap-1.5" aria-labelledby="learned-heading">
          <h2 id="learned-heading" className="m-0 text-[15px] font-semibold">
            Here's what I learned
          </h2>
          <ul className="learned-list">
            {facts.map((f) => (
              <li key={f.id}>{factLine(f.category, f.value)}</li>
            ))}
          </ul>
        </section>
      )}
      {error && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2.5">
        <a className="btn-primary flex-1" href={`${config.appOrigin}/people/${personId}`} target="_blank" rel="noreferrer">
          See {name}'s profile
        </a>
        <button className="btn-outline flex-1" type="button" onClick={onAnother} disabled={busy}>
          Capture another
        </button>
      </div>
    </div>
  );
}
