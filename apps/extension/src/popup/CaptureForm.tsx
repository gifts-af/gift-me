import { useId } from "react";

// The optional note, the Save button and any save error with Try again.
export function CaptureForm({
  note,
  onNoteChange,
  saveLabel,
  canSave,
  busy,
  error,
  onSave,
}: {
  note: string;
  onNoteChange: (note: string) => void;
  saveLabel: string;
  canSave: boolean;
  busy: boolean;
  error: string | null;
  onSave: () => void;
}) {
  const id = useId();
  return (
    <>
      <label className="field" htmlFor={id}>
        <span>
          Note <span className="text-[13px] font-normal text-muted-foreground">Optional</span>
        </span>
        <textarea
          className="input resize-none"
          id={id}
          rows={2}
          maxLength={2000}
          placeholder="She loved this in the store"
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
        />
      </label>
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
