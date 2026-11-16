// My list's gifts, saved as they change (ALL-127, design/ui.md > My list).
// Plain JS with no React, so the rules read top to bottom; GiftApp reads it
// through useSyncExternalStore.
//
// - An add saves at once. One save at a time; the next carries every change
//   made since, so the latest state wins.
// - A remove is held for UNDO_MS so Undo can put it back without the server
//   ever deleting the gift (and the claims on it). Any save in that window
//   sends the held gift in its old place. The remove is sent when the window
//   closes, when a second gift is removed, or when the page goes (flush, and
//   sendOnClose for a closing tab).
// - Each save carries the list's version. When it's refused as stale, the
//   latest list comes back; this tab's own adds and removes are put back on
//   top of it and saved once more. A second refusal shows "Couldn't save".

export const UNDO_MS = 6000

export const STALE_NOTICE = "Your list changed somewhere else. We've loaded the latest."
const OFFLINE_ERROR = "Your list couldn't be saved. Check your connection and try again."

/** The list with the held gift back in its old place. */
function withHeld(gifts, held) {
  if (!held) return gifts
  const next = [...gifts]
  next.splice(Math.min(held.index, next.length), 0, held.gift)
  return next
}

/**
 * @param {{
 *   initial: import('./lists').MyList | null,
 *   enabled: boolean,
 *   save: typeof import('../actions/lists').saveList,
 *   sendOnClose: (body: { listId: string, version: string, removeIds: string[] }) => void,
 * }} deps
 * With `enabled` false (a guest, or a list that couldn't load) changes stay on
 * this device: nothing is held or saved.
 */
export function createListSaver({ initial, enabled, save, sendOnClose }) {
  const items = initial?.items ?? []
  const s = {
    gifts: items, // on screen
    held: null, // { gift, index }: removed, waiting out the Undo window
    listId: initial?.list?.id ?? null,
    version: initial?.list?.version ?? null,
    shareToken: initial?.list?.shareToken ?? null,
    // The gift ids the server had at `version`: anything here but not on this
    // device was removed here; anything on this device but not here was added.
    known: new Set(items.map((g) => g.id)),
    status: 'idle', // 'idle' | 'saving' | 'error'
    error: '',
    notice: '',
    dirty: false, // changed since load, for a list that can't save
  }
  let changes = 0 // bumped when the list a save would send changes
  let running = null // the save loop, while it runs
  let wanted = false // a change waits for the next save
  let timer = null
  const listeners = new Set()
  let snapshot

  function publish() {
    snapshot = {
      gifts: s.gifts,
      held: s.held,
      status: s.status,
      error: s.error,
      notice: s.notice,
      dirty: s.dirty,
      listId: s.listId,
      shareToken: s.shareToken,
    }
    listeners.forEach((listener) => listener())
  }
  publish()

  const full = () => withHeld(s.gifts, s.held)

  function requestSave() {
    if (!enabled) return Promise.resolve()
    wanted = true
    if (!running) running = loop()
    return running
  }

  async function loop() {
    while (wanted) {
      wanted = false
      s.status = 'saving'
      publish()
      if (!(await saveOnce())) {
        s.status = 'error'
        running = null
        publish()
        return
      }
    }
    s.status = 'idle'
    running = null
    publish()
  }

  // One save, and if it's refused as stale, one more on top of the latest.
  async function saveOnce() {
    for (let attempt = 0; attempt < 2; attempt++) {
      const sent = full()
      const at = changes
      let result
      try {
        result = await save({ listId: s.listId, version: s.version, items: sent })
      } catch {
        result = { ok: false, error: OFFLINE_ERROR }
      }
      if (result.ok) {
        s.listId = result.listId
        s.version = result.version
        if (result.shareToken) s.shareToken = result.shareToken
        s.known = new Set(result.items.map((g) => g.id))
        // Take the server's rows only if nothing changed mid-save.
        if (changes === at) adopt(result.items)
        if (attempt === 1) s.notice = STALE_NOTICE
        s.error = ''
        return true
      }
      if (!result.stale) {
        s.error = result.error
        return false
      }
      rebase(result)
      publish()
    }
    s.error = '' // refused twice: the header says "Couldn't save"
    return false
  }

  function adopt(rows) {
    if (!s.held) {
      s.gifts = rows
      return
    }
    const index = rows.findIndex((g) => g.id === s.held.gift.id)
    if (index === -1) return
    s.held = { gift: rows[index], index }
    s.gifts = rows.filter((_, i) => i !== index)
  }

  // This tab's adds and removes, put back on top of the latest list.
  function rebase(latest) {
    const local = full()
    const localIds = new Set(local.map((g) => g.id))
    const added = local.filter((g) => !s.known.has(g.id))
    const removed = new Set([...s.known].filter((id) => !localIds.has(id)))
    const kept = latest.items.filter((g) => !removed.has(g.id))
    const keptIds = new Set(kept.map((g) => g.id))
    const merged = [...kept, ...added.filter((g) => !keptIds.has(g.id))]

    s.listId = latest.listId
    s.version = latest.version
    s.shareToken = latest.shareToken ?? s.shareToken
    s.known = new Set(latest.items.map((g) => g.id))
    if (s.held) {
      const index = merged.findIndex((g) => g.id === s.held.gift.id)
      if (index === -1) {
        // Removed somewhere else too: nothing left to hold.
        clearTimeout(timer)
        timer = null
        s.held = null
      } else {
        s.held = { gift: merged[index], index }
        merged.splice(index, 1)
      }
    }
    s.gifts = merged
    changes++
  }

  /** Sends the held remove now. Resolves when every save so far has finished. */
  function release() {
    if (!s.held) return running ?? Promise.resolve()
    clearTimeout(timer)
    timer = null
    s.held = null
    changes++
    publish()
    return requestSave()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,

    add(...gifts) {
      s.gifts = [...s.gifts, ...gifts]
      s.notice = ''
      s.dirty = true
      changes++
      publish()
      requestSave()
    },

    remove(id) {
      if (!enabled) {
        s.gifts = s.gifts.filter((g) => g.id !== id)
        s.dirty = true
        publish()
        return
      }
      if (s.held) release() // one held remove at a time: the first goes now
      const index = s.gifts.findIndex((g) => g.id === id)
      if (index === -1) return
      s.held = { gift: s.gifts[index], index }
      s.gifts = s.gifts.filter((_, i) => i !== index)
      s.notice = ''
      timer = setTimeout(release, UNDO_MS)
      publish()
    },

    undo() {
      if (!s.held) return
      clearTimeout(timer)
      timer = null
      s.gifts = withHeld(s.gifts, s.held)
      s.held = null
      publish()
    },

    retry: () => requestSave(),

    /** The page is being left in the app, hidden, or signed out of. */
    flush: release,

    /**
     * The tab is closing: a server action would be cancelled, so the removes
     * not yet saved go to the close route with keepalive, as ids only.
     */
    closing() {
      if (!enabled || !s.listId || !s.version) return
      const onScreen = new Set(s.gifts.map((g) => g.id))
      const removeIds = [...s.known].filter((id) => !onScreen.has(id))
      clearTimeout(timer)
      timer = null
      s.held = null
      publish()
      if (removeIds.length > 0) sendOnClose({ listId: s.listId, version: s.version, removeIds })
    },
  }
}
