// What was said in a level, as plain functions over the store's rows: which
// lines a page shows, who is near enough to hear whom, and whose words float
// over their head. Nothing here touches the page or the network, so every page
// shows the same lines from the same rows.
//
// A line is a row carrying `chat` (the level it was said in, and the hero who
// said it) and `doc` (the words), stamped by the store with `created` (the
// person who wrote it, and when the store took it). The rule reads only those
// stamps, never what the speaker's page says of itself: a line counts when a
// person signed in wrote it, as a hero they made, and no sooner than a second
// after the last line of theirs that counted. However fast a page writes, or
// however many lines it packs into one write (the store stamps them all with
// the one instant), each person is heard at most once a second.
//
// Who is near whom (`earshot`) is the seam proximity voice will hear through:
// the same reach, the same bodies.
import type { Bundle } from './net.ts'

/** A line, as the store stamped it. */
export type Line = {
  eid: string
  /** the hero who said it */
  player: string
  /** the person who wrote it, by the store's `created.by`; empty for nobody */
  by: string
  text: string
  /** when the store took it, in ms */
  at: number
}

/** The most a line says, in characters. */
export let MAX = 160

/** A person is heard at most once in this long, in ms. */
export let PACE = 1000

/** How long words float over a speaker's head, in ms. */
export let BUBBLE = 5000

/** How near, in metres, a speaker is heard: their words float over their
 * head for whoever is this close. */
export let EARSHOT = 22

/**
 * The words of a line as they are shown: one line of plain text, its spaces
 * run together, at most `MAX` characters.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { clean, MAX } from './chat.ts'
 * assertEquals(clean('  hello\n\tthere  '), 'hello there')
 * assertEquals(clean('a\u0000b\u001bc'), 'a b c')
 * assertEquals(clean('x'.repeat(400)).length, MAX)
 * ```
 */
export let clean = (text: string): string =>
  text.replace(/[\s\p{Cc}]+/gu, ' ').trim().slice(0, MAX)

// A component of a row, or of a reference the store spelled out, as an object
// whatever it held.
let part = (v: unknown): Record<string, unknown> =>
  v && typeof v == 'object' ? { ...v } : {}

/**
 * A line off a row the store holds, or nothing when the row is not one. The
 * store says who wrote it either as their eid or as `{eid, name}`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { lineOf } from './chat.ts'
 * assertEquals(
 *   lineOf({
 *     entity: { eid: 'l1' },
 *     chat: { level: 'home', player: 'h1' },
 *     doc: { body: ' hi\nthere ' },
 *     created: { by: { eid: 'p1', name: 'Ann' }, at: '1970-01-01T00:00:02Z' },
 *   }),
 *   { eid: 'l1', player: 'h1', by: 'p1', text: 'hi there', at: 2000 },
 * )
 * assertEquals(
 *   lineOf({ entity: { eid: 'l2' }, chat: { player: 'h1' }, doc: {} }),
 *   null,
 * )
 * ```
 */
export let lineOf = (b: Bundle): Line | null => {
  let chat = part(b.chat), doc = part(b.doc)
  let text = clean(typeof doc.body == 'string' ? doc.body : '')
  if (typeof chat.player != 'string' || !text) return null
  return {
    eid: b.entity.eid,
    player: chat.player,
    by: writer(b),
    text,
    at: Date.parse(String(part(b.created).at ?? '')) || 0,
  }
}

/**
 * Who wrote a row, as the store stamped it: their eid, or nothing for nobody.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { writer } from './chat.ts'
 * let row = (by: unknown) => ({ entity: { eid: 'r' }, created: { by } })
 * assertEquals(writer(row('p1')), 'p1')
 * assertEquals(writer(row({ eid: 'p1', name: 'Ann' })), 'p1')
 * assertEquals(writer(row(null)), '')
 * assertEquals(writer(undefined), '')
 * ```
 */
export let writer = (b: Bundle | undefined): string => {
  let by = part(b?.created).by
  return typeof by == 'string' ? by : String(part(by).eid ?? '')
}

/**
 * The lines a page shows, oldest first: each written by a person signed in,
 * as a hero `owner` says is theirs, and a second or more after the last line
 * of theirs that counted.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { heard } from './chat.ts'
 * let line = (eid: string, by: string, at: number, player = 'h-' + by) =>
 *   ({ eid, player, by, text: eid, at })
 * let owner = (hero: string) => hero.slice(2)
 * let said = (lines: ReturnType<typeof line>[]) =>
 *   heard(lines, owner).map((l) => l.eid)
 *
 * // Oldest first, however they came.
 * assertEquals(said([line('b', 'ann', 2000), line('a', 'bo', 1000)]), [
 *   'a',
 *   'b',
 * ])
 * // Nobody signed in is not heard.
 * assertEquals(said([line('a', '', 1000)]), [])
 * // Nor is a line as somebody else's hero.
 * assertEquals(said([line('a', 'ann', 1000, 'h-bo')]), [])
 * // A person is heard once a second, however many lines they send at once.
 * assertEquals(
 *   said([
 *     line('a', 'ann', 1000),
 *     line('b', 'ann', 1000),
 *     line('c', 'ann', 1500),
 *     line('d', 'bo', 1500),
 *     line('e', 'ann', 2000),
 *   ]),
 *   ['a', 'd', 'e'],
 * )
 * ```
 */
export let heard = (
  lines: Line[],
  owner: (hero: string) => string | null,
  pace = PACE,
): Line[] => {
  let last = new Map<string, number>()
  return [...lines]
    .sort((a, b) => a.at - b.at || (a.eid < b.eid ? -1 : 1))
    .filter((l) => {
      if (!l.by || owner(l.player) != l.by) return false
      if (l.at - (last.get(l.by) ?? -Infinity) < pace) return false
      last.set(l.by, l.at)
      return true
    })
}

type Placed = { eid: string; body: { x: number; z: number } }

/**
 * Who is within `reach` of a place: the eids of those near enough to hear
 * someone standing there, and to be heard by them.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { earshot } from './chat.ts'
 * let at = (eid: string, x: number) => ({ eid, body: { x, z: 0 } })
 * assertEquals(earshot({ x: 0, z: 0 }, [at('a', 5), at('b', 50)]), ['a'])
 * assertEquals(earshot({ x: 0, z: 0 }, [at('a', 5)], 4), [])
 * ```
 */
export let earshot = (
  at: { x: number; z: number },
  others: Placed[],
  reach = EARSHOT,
): string[] =>
  others
    .filter((o) => Math.hypot(o.body.x - at.x, o.body.z - at.z) <= reach)
    .map((o) => o.eid)

/**
 * The words floating over heads at `now`: for each hero `near`, the last line
 * they said, while it is younger than `BUBBLE`. Lines come oldest first, as
 * `heard` gives them.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { bubbles } from './chat.ts'
 * let line = (eid: string, player: string, at: number) =>
 *   ({ eid, player, by: player, text: eid, at })
 * let lines = [line('a', 'ann', 1000), line('b', 'ann', 3000),
 *   line('c', 'bo', 3000), line('d', 'cy', 500)]
 * let near = new Set(['ann', 'cy'])
 * assertEquals(bubbles(lines, near, 7000).map((l) => l.eid), ['b'])
 * assertEquals(bubbles(lines, near, 9000), [])
 * ```
 */
export let bubbles = (
  lines: Line[],
  near: Set<string>,
  now: number,
): Line[] => {
  let last = new Map<string, Line>()
  for (let l of lines) if (near.has(l.player)) last.set(l.player, l)
  return [...last.values()].filter((l) => now - l.at < BUBBLE)
}
