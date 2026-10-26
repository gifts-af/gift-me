export default function SaveButton({ blockedReason, dirty, saving, onSave }) {
  if (blockedReason) {
    // aria-disabled rather than disabled: a disabled button gets no hover or
    // focus events, so the tooltip explaining *why* could never appear.
    return (
      <span className="tooltip-anchor">
        <button
          type="button"
          className="btn btn--muted"
          aria-disabled="true"
          aria-describedby="save-tooltip"
          onClick={(event) => event.preventDefault()}
        >
          Save
        </button>
        <span className="tooltip" id="save-tooltip" role="tooltip">
          {blockedReason}
        </span>
      </span>
    )
  }

  return (
    <button
      type="button"
      className="btn btn--primary"
      onClick={onSave}
      disabled={saving || !dirty}
      aria-busy={saving}
    >
      {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
    </button>
  )
}
