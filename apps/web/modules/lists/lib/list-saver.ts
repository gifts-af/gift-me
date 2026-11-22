// My list's gifts, saved as they change (ALL-127, design/ui.md > My list).
// Plain JS with no React, so the rules read top to bottom; GiftApp reads it
// through useSyncExternalStore.
//
// - An add saves at once. One save at a time; the next carries every change
//   made since, so the latest state wins.
// - A remove is held for UNDO_MS so Undo can put it back without the server
//   ever deleting the gift (and the claims on it). The window waits while the
//   Undo bar has focus or the pointer. Any save in that window sends the held
//   gift in its old place. The remove is sent when the window closes, when a
//   second gift is removed, or when the page goes (flush, or closing() for a
//   hidden or closing tab).
// - Each save carries the list's version. When it's refused as stale, the
//   latest list comes back; this tab's own adds and removes are put back on
//   top of it and saved once more. A second refusal shows "Couldn't save".
//   Only gifts this tab removed are removed: never one it merely didn't see.

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
 *   sendOnClose: (body: { listId: string, version: string, removeIds: string[] }) =>
 *     Promise<{ version: string, behind: boolean } | null>,
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
    // The gift ids the server had at `version`. Anything on this device but
    // not here was added here.
    known: new Set(items.map((g) => g.id)),
    // Gifts this tab removed (past the Undo window) that no save has
    // confirmed yet. A merge removes only these.
    removing: new Set(),
    status: 'idle', // 'idle' | 'saving' | 'error'
    error: '',
    notice: '',
    dirty: false, // changed since load, for a list that can't save
  }
  let changes = 0 // bumped when the list a save would send changes
  let running = null // the save loop, while it runs
  let wanted = false // a change waits for the next save
  let timer = null
  let deadline = 0
  let remaining = UNDO_MS
  const pauses = new Set() // why the Undo window is waiting: 'focus', 'hover'
  const closeSent = new Set() // ids on their way to the close route
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
      const sentIds = new Set(sent.map((g) => g.id))
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
        // A remove this save didn't carry is now confirmed gone.
        for (const id of s.removing) if (!sentIds.has(id)) s.removing.delete(id)
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
    const added = full().filter((g) => !s.known.has(g.id))
    const kept = latest.items.filter((g) => !s.removing.has(g.id))
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
        clearHeld()
      } else {
        s.held = { gift: merged[index], index }
        merged.splice(index, 1)
      }
    }
    s.gifts = merged
    changes++
  }

  function startTimer() {
    clearTimeout(timer)
    timer = null
    if (!s.held || pauses.size > 0) return
    deadline = Date.now() + remaining
    timer = setTimeout(release, remaining)
  }

  function clearHeld() {
    clearTimeout(timer)
    timer = null
    pauses.clear()
    s.held = null
  }

  /** Lets the held remove go: it's now one of this tab's removes. */
  function letGo() {
    s.removing.add(s.held.gift.id)
    clearHeld()
    changes++
    publish()
  }

  /** Sends the held remove now. Resolves when every save so far has finished. */
  function release() {
    if (!s.held) return running ?? Promise.resolve()
    letGo()
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
      remaining = UNDO_MS
      startTimer()
      publish()
    },

    undo() {
      if (!s.held) return
      s.gifts = withHeld(s.gifts, s.held)
      clearHeld()
      publish()
    },

    /** The Undo window waits while the bar has focus or the pointer. */
    pauseUndo(reason) {
      if (pauses.has(reason)) return
      pauses.add(reason)
      if (timer) {
        remaining = Math.max(0, deadline - Date.now())
        clearTimeout(timer)
        timer = null
      }
    },
    resumeUndo(reason) {
      if (pauses.delete(reason) && pauses.size === 0) startTimer()
    },

    retry: () => requestSave(),

    /** The page is being left in the app or signed out of. */
    flush: release,

    /**
     * The tab is hidden or closing: a server action may be cancelled, so the
     * removes not yet saved go to the close route with keepalive, as ids
     * only, each once. A tab that lives on carries on from the version the
     * route saved, if nothing else changed meanwhile.
     */
    closing() {
      if (!enabled) return
      if (s.held) {
        // A gift the server never had (or no list yet) is a normal save.
        if (!s.listId || !s.version || !s.known.has(s.held.gift.id)) release()
        else letGo()
      }
      if (!s.listId || !s.version) return
      const removeIds = [...s.removing].filter((id) => s.known.has(id) && !closeSent.has(id))
      if (removeIds.length === 0) return
      removeIds.forEach((id) => closeSent.add(id))
      const body = { listId: s.listId, version: s.version, removeIds }
      const at = changes
      Promise.resolve(sendOnClose(body))
        .then((result) => {
          // Not saved, and the tab is still here: the next save carries it.
          if (!result) return requestSave()
          if (result.behind || typeof result.version !== 'string') return
          if (running || changes !== at || s.version !== body.version) return
          s.version = result.version
          for (const id of removeIds) {
            s.known.delete(id)
            s.removing.delete(id)
          }
        })
        .catch(() => {})
        .finally(() => removeIds.forEach((id) => closeSent.delete(id)))
    },
  }
}
