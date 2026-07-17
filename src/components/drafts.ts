// Typing must survive a hot swap. The hmr remount replaces every DOM
// node, and every entry surface is uncontrolled — half-typed text lives
// only in the node being thrown away. A draft is that text, saved on
// every keystroke and dropped on commit or revert, so the next mount —
// hmr swap, full reload, server restart, even a closed and reopened
// card — reseeds the editor where typing stopped. sessionStorage keeps
// drafts per-tab and out of the graph: half-typed words are nobody
// else's business. Saving also names the key the focus heir, so after
// a swap the editor that was being typed in takes the caret back.

type Draft = { v: string; caret?: number; t: number }

// Deno (the TUI, tests) has no sessionStorage; a Map stands in.
let mem = new Map<string, string>()
let store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> =
  globalThis.sessionStorage ?? {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  }

// A stale draft resurrecting old words is worse than a lost one.
let TTL = 15 * 60_000

export let save = (key: string, v: string, caret?: number) => {
  store.setItem(`draft:${key}`, JSON.stringify({ v, caret, t: Date.now() }))
  store.setItem('draft:focus', key)
}

export let peek = (key: string, now = Date.now()): Draft | null => {
  let raw = store.getItem(`draft:${key}`)
  if (!raw) return null
  try {
    let d = JSON.parse(raw) as Draft
    if (now - d.t > TTL) {
      drop(key)
      return null
    }
    return d
  } catch {
    return null
  }
}

export let drop = (key: string) => {
  store.removeItem(`draft:${key}`)
  if (store.getItem('draft:focus') == key) store.removeItem('draft:focus')
}

export let focused = (key: string) => store.getItem('draft:focus') == key
