// What the page's drawing shows and how far it is drawn: the query it draws,
// where the story's entities sit, how far the reader has scrolled into each
// step, and what the last write made and which phases of apply() it ran.
import type { Layout } from '@yaks/diagram'
import type { Yak } from './yak.ts'
import { LIVE } from './term.ts'

/** The page's drawing: the query it shows, how far each stage is drawn, and
 * the last write it saw. */
export type Figure = ReturnType<typeof figure>

/** What the drawing shows unless the visitor asks for more: only what the
 * story and the visitor make, not the site the graph also holds. */
export const STORY = '.task|.comment|.edge|.person|.persona *'

/** Queries a visitor can widen the drawing to, by what they show. */
export const WIDER: [string, string][] = [
  ['the demo', STORY],
  ["the site's files", '.file *'],
  ["the page's sections", '.doc|.pane|.layout *'],
  ['everything', '*'],
]

/** The drawing's size, in its own units: taller than wide, beside the words. */
export const SHEET = { width: 560, height: 620 }

/** Where the story's entities sit, as fractions of the sheet, by the number
 * each is given as the story runs. */
export const PLACES: Record<string, [number, number]> = {
  'U-1': [.2, .11],
  'T-2': [.64, .22],
  'T-3': [.64, .55],
  'N-4': [.2, .8],
  'C-5': [.7, .86],
}

/** The first stage what a wider query adds is drawn in; a visitor's lines
 * are drawn from LIVE up to it. */
const ASKED = LIVE * 2

/** How long a stage takes to draw in once it has been written, in ms. */
const RAMP = 1100

let clamp = (v: number) => Math.max(0, Math.min(1, v))

/** Where the reader reads, as a fraction of the window's height from its
 * top: what has passed it has been read. */
export const LINE = .62

/** How far into a step the reader is, 0 to 1, from where the step sits in
 * the window: it starts as the step's top passes the reading line and is
 * done half a screen (or half the step) later. */
export let into = (top: number, height: number, view: number) =>
  clamp((view * LINE - top) / Math.max(1, Math.min(height, view) * .5))

export let figure = (yak: Yak) => {
  let query = STORY
  let last: { eid?: string; phases: string[] } = { phases: [] }
  let listeners = new Set<() => void>()
  let told = () => listeners.forEach((l) => l())
  // A write's subject is the entity it made or changed that is not the call
  // that asked for it.
  yak.listen(({ bundles, phases }) => {
    let made = bundles.filter((b) => !b.call && !b.result && !b.tool)
    if (!made.length) return
    let subject = made.find((b) => !b.edge) ?? made[0]
    last = { eid: subject.entity.eid, phases: [...phases] }
    told()
  })

  // How far the reader is into each step, and when each stage first showed.
  let scrolled: number[] = []
  let born = new Map<number, number>()
  let asked = 0
  let live = false
  let since = (stage: number, now: number) => {
    let at = born.get(stage)
    return at == null ? 1 : clamp((now - at) / RAMP)
  }
  return {
    query: () => query,
    /** Draw another query: what it adds is drawn in as a stage of its own. */
    ask: (q: string) => {
      query = q
      told()
      return ASKED + asked++
    },
    last: () => last,
    listen: (l: () => void) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    /** The reader is `p[i]` of the way into step i + 1. */
    scroll: (p: number[]) => void (scrolled = p),
    /** How far into step n (from 1) the reader is. */
    into: (n: number) => scrolled[n - 1] ?? 0,
    /** A layout was drawn at `now`: each stage it shows for the first time
     * starts drawing in. */
    saw: (layout: Layout, now: number) => {
      for (let x of [...layout.nodes, ...layout.links]) {
        if (!born.has(x.stage)) born.set(x.stage, now)
        if (x.stage >= LIVE && x.stage < ASKED) live = true
      }
    },
    /** How far a stage has come in at `now`: a step as far as the reader has
     * scrolled into it, once it has been written; the start and anything the
     * visitor did as soon as it is written. Once the visitor has typed, the
     * story stays drawn wherever they scroll; widening the query does not
     * count as typing. */
    reached: (stage: number, now: number) => {
      let t = since(stage, now)
      if (stage == 0 || stage >= LIVE || live) return t
      return Math.min(t, scrolled[stage - 1] ?? 0)
    },
    /** Some stage is still drawing in by itself at `now`. */
    busy: (now: number) => [...born.values()].some((at) => now - at < RAMP),
  }
}
