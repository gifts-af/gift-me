import { BlockedButton, buttonClass } from './ui.jsx'

export default function SaveButton({ blockedReason, saving, onSave }) {
  if (blockedReason) {
    return (
      <BlockedButton id="save-tooltip" reason={blockedReason} className={buttonClass.primary}>
        Save
      </BlockedButton>
    )
  }

  return (
    <button
      type="button"
      className={buttonClass.primary}
      onClick={onSave}
      disabled={saving}
      aria-busy={saving}
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  )
}
