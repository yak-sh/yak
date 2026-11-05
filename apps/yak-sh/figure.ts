// What the page's drawing shows and how far it is drawn: the query it draws,
// where the story's entities sit, how far the reader has scrolled into each
// step, which command made each thing it draws, and what the last write made
// and which phases of apply() it ran.
import type { Layout } from '@yaks/diagram'
import type { Bundle } from '@yaks/graph'
import type { Change, Yak } from './yak.ts'
import { type At, BAND, type Line, LIVE, type Term } from './term.ts'

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
  'U-1': [.18, .12],
  'T-3': [.68, .1],
  'T-4': [.68, .34],
  'T-2': [.68, .56],
  'N-5': [.18, .78],
  'T-7': [.68, .8],
  'T-8': [.42, .24],
  'C-9': [.47, .45],
  'C-6': [.36, .93],
}

/** Where a letter sits, which has no number: under you, beside the question
 * it asks, above where the windows dock. */
const LETTER: [number, number] = [.14, .33]

/** Where an entity the story makes sits: by its number, or a letter's. */
export let placeOf = ({ label, bundle }: { label: string; bundle: Bundle }) =>
  PLACES[label] ?? (bundle.mail ? LETTER : undefined)

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

/** The last write the prompt made: the command that made it, the entity it
 * made or changed, the phases of apply() it ran with the batch as each left
 * it, and what the effects it owed wrote to that entity after its commit. */
export type Last = {
  line?: Line
  eid?: string
  phases: string[]
  steps: Change['steps']
  later: Bundle[]
}

// What a pool or a tool call keeps about the work, rather than the work.
const KEPT = ['call', 'result', 'tool', 'execution', 'effect', 'lease']

// What every bundle has or apply() stamps on it, rather than what was written.
const ANY = ['entity', 'created', 'updated']

/** A write's subject: the first entity it wrote a component to that is not
 * the call that asked for it or the pool's record of a run, and not an edge
 * where it wrote anything else. */
export let subjectOf = (bundles: Bundle[]) => {
  let said = bundles.filter((b) =>
    !KEPT.some((c) => b[c]) &&
    Object.keys(b).some((k) => !k.startsWith('$') && !ANY.includes(k))
  )
  return (said.find((b) => !b.edge) ?? said[0])?.entity.eid
}

export let figure = (yak: Yak, term: Term) => {
  let query = STORY
  let picked: string | undefined
  let last: Last = { phases: [], steps: [], later: [] }
  let listeners = new Set<() => void>()
  let told = () => listeners.forEach((l) => l())
  // The command that first wrote each entity, and each component on one.
  let wrote = new Map<string, At>()
  yak.listen(({ bundles, phases, steps, generation }) => {
    let at = term.at()
    for (let b of bundles) {
      let eid = b.entity.eid
      for (let k of [eid, ...Object.keys(b).map((c) => `${eid} ${c}`)]) {
        if (!wrote.has(k)) wrote.set(k, at)
      }
    }
    // What an effect wrote after the commit, to the last write's entity.
    if (generation) {
      let more = bundles.filter((b) => b.entity.eid == last.eid)
      if (!more.length) return
      last = { ...last, later: [...last.later, ...more] }
      return told()
    }
    // The last write is the prompt's own, not another interface's.
    let eid = subjectOf(bundles)
    if (!eid || !term.busy()) return
    let line = term.lines().findLast((l) => l.kind == 'in' || l.kind == 'agent')
    last = { line, eid, phases: [...phases], steps, later: [] }
    told()
  })

  // How far the reader is into each step, and when each stage first showed.
  let scrolled: number[] = []
  let born = new Map<number, number>()
  let asked = 0
  let live = false
  let seen: Layout | undefined
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
    /** The command that made what the drawing draws under `key`: a shape's
     * entity, a line's edge entity, or the component on the line's first end
     * that names its other. */
    madeBy: (key: string): At | undefined => {
      let node = seen?.nodes.find((n) => n.eid == key)
      if (node) return wrote.get(node.eid)
      let link = seen?.links.find((l) => l.key == key)
      if (!link) return
      return wrote.get(link.eid ?? `${link.from} ${link.name.split('.')[0]}`)
    },
    /** The entity the reader opened, if any. */
    picked: () => picked,
    /** Open an entity, or close the one open (undefined). */
    pick: (eid: string | undefined) => {
      picked = eid
      told()
    },
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
      seen = layout
      for (let x of [...layout.nodes, ...layout.links]) {
        if (!born.has(x.stage)) born.set(x.stage, now)
        if (x.stage >= LIVE && x.stage < ASKED) live = true
      }
    },
    /** How far a stage has come in at `now`: a step as far as the reader has
     * scrolled into it, once it has been written; the start, what a band
     * runs and anything the visitor did as soon as it is written. Once the visitor has typed, the
     * story stays drawn wherever they scroll; widening the query does not
     * count as typing. */
    reached: (stage: number, now: number) => {
      let t = since(stage, now)
      if (stage == 0 || stage >= BAND || live) return t
      return Math.min(t, scrolled[stage - 1] ?? 0)
    },
    /** Some stage is still drawing in by itself at `now`. */
    busy: (now: number) => [...born.values()].some((at) => now - at < RAMP),
  }
}
