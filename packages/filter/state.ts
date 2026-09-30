/**
 * A query being typed, and what each action makes of it. The `filter`
 * component (vocab.json) holds the text and the caret, the word being
 * completed (`from` to `to`), what can replace it, and which of those is
 * picked; the list is open while it has candidates. Where the word already
 * reads whole, nothing is picked: Enter keeps it as typed, and Tab takes the
 * first to read on. Each function here is pure: a row in, the patch it
 * becomes out.
 *
 * @module
 */

import type { Cand, Completion } from '@yaks/query'

/** What the `filter` component holds. */
export type Row = {
  text: string
  caret: number
  /** where the word being completed starts */
  from: number
  /** where it ends */
  to: number
  /** what can replace it */
  cands: Cand[]
  /** which of `cands` is picked, -1 for none */
  pick: number
}

/** The most candidates the list shows. */
export let CAP = 8

/** The field as the person left it: the text, the caret, and what can come
 * next there, the first picked unless what is typed already reads whole.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { typed } from '@yaks/filter'
 *
 * let cands = [{ text: '.status', kind: 'task' }]
 * let found = { from: 0, to: 2, cands, whole: false }
 * assertEquals(typed('.s', 2, found).cands, found.cands)
 * ```
 */
export let typed = (text: string, caret: number, found: Completion): Row => ({
  text,
  caret,
  from: found.from,
  to: found.to,
  cands: found.cands.slice(0, CAP),
  pick: found.whole ? -1 : 0,
})

/** The field as its host put it: the text, and nothing offered. */
export let placed = (text: string, caret = text.length): Row => ({
  text,
  caret,
  from: caret,
  to: caret,
  cands: [],
  pick: 0,
})

/** The pick `d` rows on, held to the list. */
export let moved = (r: Row, d: number): Partial<Row> => ({
  pick: Math.min(Math.max(r.pick + d, 0), r.cands.length - 1),
})

/** The text with candidate `i` (the pick, or else the first) in place of the
 * word being completed, and the caret after it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { taken, typed } from '@yaks/filter'
 *
 * let cands = [{ text: '.status=', kind: 'is' }]
 * let found = { from: 6, to: 8, cands, whole: false }
 * assertEquals(taken(typed('.task .s x', 8, found)), {
 *   text: '.task .status= x',
 *   caret: 14,
 * })
 * ```
 */
export let taken = (
  r: Row,
  i = Math.max(r.pick, 0),
): { text: string; caret: number } => {
  let word = r.cands[i]?.text ?? r.text.slice(r.from, r.to)
  return {
    text: r.text.slice(0, r.from) + word + r.text.slice(r.to),
    caret: r.from + word.length,
  }
}

/** The list closed. */
export let dismissed: Partial<Row> = { cands: [], pick: 0 }

/** What a key does while the list is open. */
export type Act = 'accept' | 'up' | 'down' | 'dismiss'

// The keys, named as a browser names them; a terminal spells its own the same.
let KEYS: Record<string, Act> = {
  Tab: 'accept',
  Enter: 'accept',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Escape: 'dismiss',
}

/** The act a key is on this row: one of the list's while it is open, and none
 * otherwise, so the key is its host's. Enter takes only a pick, so with
 * nothing picked it is the host's too.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { act, placed } from '@yaks/filter'
 *
 * assertEquals(act(placed('.s'), 'Enter'), undefined)
 * ```
 */
export let act = (r: Row | undefined, key: string): Act | undefined =>
  !r?.cands.length || key == 'Enter' && r.pick < 0 ? undefined : KEYS[key]
