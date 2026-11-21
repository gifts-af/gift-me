// The optional note, the Save button and any save error with Try again,
// pinned under the people list.
export function CaptureForm({
  note,
  onNoteChange,
  saveLabel,
  moneyNotice,
  canSave,
  busy,
  error,
  onSave,
}: {
  note: string;
  onNoteChange: (note: string) => void;
  saveLabel: string;
  /** The alpha money notice (ALL-94); null when saving won't spend anything. */
  moneyNotice: string | null;
  canSave: boolean;
  busy: boolean;
  error: string | null;
  onSave: () => void;
}) {
  return (
    <>
      <input
        className="input"
        aria-label="Note (optional)"
        placeholder="Note (optional)"
        maxLength={2000}
        autoComplete="off"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
      />
      {moneyNotice && (
        <p role="note" className="m-0 rounded-md bg-warning-soft px-2.5 py-1.5 text-[13px] text-warning">
          {moneyNotice}
        </p>
      )}
      {busy && (
        <p className="m-0 text-sm text-muted-foreground" role="status">
          Reading the page…
        </p>
      )}
      {error && (
        <div role="alert" className="flex items-center justify-between gap-2 text-sm text-destructive">
          <span>{error}</span>
          <button className="btn-link shrink-0" type="button" onClick={onSave} disabled={busy}>
            Try again
          </button>
        </div>
      )}
      <button className="btn-primary" type="button" disabled={!canSave || busy} aria-busy={busy} onClick={onSave}>
        {busy ? "Saving…" : saveLabel}
      </button>
    </>
  );
}
