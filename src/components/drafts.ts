// Typing must survive a hot swap. The hmr remount replaces every DOM
// node, and every entry surface is uncontrolled — half-typed text lives
// only in the node being thrown away. A draft is that text, saved on
// every keystroke and dropped on commit or revert, so the next mount —
// hmr swap, full reload, server restart, even a closed and reopened
// card — reseeds the editor where typing stopped. sessionStorage keeps
// drafts per-tab and out of the graph: half-typed words are nobody
// else's business. Saving also names the key the focus heir, so after
// a swap the editor that was being typed in takes the caret back.
//
// save/peek/drop/focused are the storage; useDraft below is the field-
// side vocabulary composed from them — the warm path every text input
// reaches for, so persistence is one hook away and never per-site
// discipline to remember.

import { useEffect } from 'preact/hooks'

type Draft = { v: string; caret?: number }

// Deno (the TUI, tests) has no sessionStorage; a Map stands in.
let mem = new Map<string, string>()
let store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> =
  globalThis.sessionStorage ?? {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  }

// Drafts never expire: they're the user's words, and losing work is
// always worse than resurfacing it. Only commit or revert spends one.

export let save = (key: string, v: string, caret?: number) => {
  store.setItem(`draft:${key}`, JSON.stringify({ v, caret }))
  store.setItem('draft:focus', key)
}

export let peek = (key: string): Draft | null => {
  let raw = store.getItem(`draft:${key}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Draft
  } catch {
    return null
  }
}

export let drop = (key: string) => {
  store.removeItem(`draft:${key}`)
  if (store.getItem('draft:focus') == key) store.removeItem('draft:focus')
}

export let focused = (key: string) => store.getItem('draft:focus') == key

// Wire a text field to its draft: give useDraft a stable key and the
// field's ref, and every keystroke is saved, the next mount reseeds the
// text (and, when this field was the one the pen last touched, the
// caret), and commit or cancel spends it. The field stays UNCONTROLLED —
// the DOM owns the text, which is exactly what lets a half-typed word
// outlive the component tree a hot swap discards. `seed` reflects a
// restored or edited line into whatever the host derives from it (the
// board's chips, the filter signal, the search) so the mirror never lags
// the text. An empty key is a no-op, so a field that only exists once a
// verb/mode opens it can pass '' until it does. Surfaces whose mount is
// driven by a shell signal (the palette, the command line) still wire
// save/peek/drop by hand — their open-ness, not the field, decides when
// to restore.
type Field = HTMLInputElement | HTMLTextAreaElement
export let useDraft = (
  key: string,
  ref: { current: Field | null },
  seed?: (v: string) => void,
) => {
  useEffect(() => {
    let el = ref.current
    if (!key || !el) return
    let d = peek(key)
    if (!d) return
    el.value = d.v
    seed?.(d.v)
    if (focused(key)) {
      el.focus()
      let at = d.caret ?? d.v.length
      el.setSelectionRange(at, at)
    }
  }, [])
  return {
    // onInput: persist the line and mirror it in one call.
    sync: (el: Field) => {
      if (!key) return
      el.value ? save(key, el.value, el.selectionStart ?? undefined) : drop(key)
      seed?.(el.value)
    },
    spend: () => key && drop(key),
  }
}
