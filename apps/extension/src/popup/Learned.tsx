import { factLine } from "@gifts-af/core";
import { config } from "../lib/config";
import type { Extraction } from "../lib/upload";

// After a capture is saved: "Here's what I learned" (ALL-25, D47), or why not.
// `extraction` is null when the server didn't say (an older web app).
export function Learned({
  personId,
  name,
  extraction,
  busy,
  error,
  onRetry,
  onAnother,
}: {
  personId: string;
  name: string;
  extraction: Extraction | null;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onAnother: () => void;
}) {
  const facts = extraction?.facts ?? [];
  return (
    <div className="flex flex-col gap-3 p-4">
      {busy ? (
        <p className="m-0 text-sm text-muted-foreground" role="status">
          Reading the page…
        </p>
      ) : extraction === null ? (
        <p className="m-0" role="status">
          Saved to {name}. We'll show you what we learned.
        </p>
      ) : extraction.status === "pending" ? (
        <p className="m-0" role="status">
          Saved. We'll learn from it later.
        </p>
      ) : extraction.status === "failed" ? (
        <div role="status" className="flex items-center justify-between gap-2 text-sm">
          <span>Couldn't read this page. The capture is saved.</span>
          <button className="btn-link shrink-0" type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : facts.length === 0 ? (
        <p className="m-0" role="status">
          Nothing new to learn from this page. The capture is saved.
        </p>
      ) : (
        <section className="flex flex-col gap-2" aria-labelledby="learned-heading">
          <h2 id="learned-heading" className="m-0 text-[15px] font-semibold">
            Here's what I learned about {name}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
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
      {extraction !== null && !busy && (
        <a className="btn-link self-start" href={`${config.appOrigin}/people/${personId}`} target="_blank" rel="noreferrer">
          See everything about {name} →
        </a>
      )}
      <button className="btn-link self-start" type="button" onClick={onAnother} disabled={busy}>
        Capture another
      </button>
    </div>
  );
}
