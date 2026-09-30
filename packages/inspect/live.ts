/**
 * The inspector's host over a server's graph: what a page (./main.ts) and a
 * terminal (./tui.ts) both supply its views, built on a @yaks/client box
 * connected to that server (@yaks/sync over @yaks/api's `/ws` and `/apply`),
 * and the page's own graph beside it for the inspector's state.
 *
 * What a view asks is a server-evaluated watch held while the view is
 * mounted, sent as it is written: a line brings the components it names,
 * and `*` every one. An aggregate is the watch's `reduced`. One asked `once`
 * is kept as it first came, its watch closed, and answered from what was
 * kept for as long as the page is open. A write goes to the server as it
 * stands, so the graph resolves what a person typed (an id, a `$` alias, an
 * edge's eid), and comes back as it was applied. An address followed (a
 * link, a row pressed) is stacked on the page's panes, in the page's own
 * graph (./state.ts `follow`).
 *
 * @module
 */

import { type Signal, signal } from '@preact/signals'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { Client, Watch } from '@yaks/client'
import { aggregate, dead, type Reduced } from '@yaks/graph'
import { human, short } from '@yaks/id'
import { parse } from '@yaks/query'
import { relative } from '@yaks/ui'
import type { Answer, Ask, Asks, Bundle, Front, Host } from './host.ts'
import { called, comp, tables } from './read.ts'
import { follow, stack } from './state.ts'
import { pagePath, queryPath } from './where.ts'

// One ask held: its answer as it stands, and letting it go.
type Held = { answer: () => Answer; drop: () => void }

let PENDING: Answer = { rows: [], ready: false }

// Whether an answer had something to draw.
let drawn = (a: Answer): boolean =>
  !!a.rows.length || a.count != null || !!a.tally

// An aggregate's answer, read the way a view reads one: a count, or each
// value by how many (a distinct value counts once).
let reading = (r: Reduced | undefined): Partial<Answer> =>
  !r
    ? {}
    : 'count' in r
    ? { count: r.count }
    : 'tally' in r
    ? { tally: r.tally }
    : { tally: Object.fromEntries(r.distinct.map((v) => [v, 1])) }

/** What a page or a terminal gives the host besides the two graphs. */
export type LiveOpts = {
  /** the graph inspected, connected to its server, its watches reactive
   * (`signal` from @preact/signals) */
  box: Client
  /** the page's own graph */
  front: Front
  /** whether controls take input: a browser's do, a terminal's paint */
  edits: boolean
}

/** The host over `box`. */
export let live = ({ box, front, edits }: LiveOpts): Host => {
  let vocab = box.vocab
  let format = human(vocab)

  // Each entity a render read, woken when its row changes.
  let turns = new Map<string, Signal<number>>()
  box.cache.onRows((eids) => {
    for (let eid of eids) {
      let t = turns.get(eid)
      if (t) t.value++
    }
  })
  let get = (eid: string): Bundle | undefined => {
    let t = turns.get(eid)
    if (!t) turns.set(eid, t = signal(0))
    t.value
    let b = box.ent(eid)
    return b && !dead(b) ? b : undefined
  }

  // What each line asked once answered, kept while the page is open.
  let kept = new Map<string, Signal<Answer | undefined>>()

  let hold = (a: Ask): Held => {
    let line = typeof a == 'string' ? a : a.query
    let once = typeof a != 'string' && a.once
    let agg: boolean
    try {
      agg = !!aggregate(parse(line))
    } catch (e) {
      let error = e instanceof Error ? e.message : String(e)
      return {
        answer: () => ({ rows: [], ready: true, error }),
        drop: () => {},
      }
    }
    let now = (w?: Watch): Answer =>
      agg
        ? {
          rows: [],
          ready: !!w?.reduced,
          error: w?.refused,
          ...reading(w?.reduced),
        }
        : { rows: w?.value ?? [], ready: !!w?.ready, error: w?.refused }
    let got = once ? kept.get(line) : undefined
    if (got?.value) return { answer: () => got!.value!, drop: () => {} }
    let w: Watch | undefined = box.watch(line, { evaluate: 'server' })
    // Asked once: the first answer is kept, and nothing is asked again.
    if (once && !got) kept.set(line, got = signal(undefined))
    let off = once
      ? w.subscribe(() => {
        let a = now(w)
        if (!a.ready || a.error) return
        got!.value = a
        drop()
      })
      : undefined
    let drop = () => {
      off?.()
      w?.close()
      w = undefined
    }
    return { answer: () => got?.value ?? now(w), drop }
  }

  // A view's asks, held while it is mounted: opened after its first render
  // (which draws them pending) and let go when it unmounts or asks others.
  // A name asked anew (the next page, another order) answers with the rows
  // it had, not ready, until the new line answers, so nothing on the page
  // jumps.
  let useAnswers = (asks: Asks): Record<string, Answer> => {
    let key = JSON.stringify(asks)
    let [held, set] = useState<{ key: string; all: [string, Held][] }>()
    useLayoutEffect(() => {
      let all = Object.entries(asks).map(([n, a]): [string, Held] => [
        n,
        hold(a),
      ])
      set({ key, all })
      return () => all.forEach(([, h]) => h.drop())
    }, [key])
    let now = new Map(held?.key == key ? held.all : [])
    let had = useRef<Record<string, Answer>>({})
    let got = Object.fromEntries(
      Object.keys(asks).map((n) => {
        let a = now.get(n)?.answer() ?? PENDING
        let was = had.current[n]
        let out = was && drawn(was) && !a.ready && !a.error && !a.rows.length
          ? { ...was, ready: false }
          : a
        return [n, out]
      }),
    )
    had.current = got
    return got
  }

  // A row asked by one component carries no other, so which kind it is (and
  // its id's prefix) is read off its archetype, the components it carries,
  // where that is held (./notes.ts `useSets`).
  let kinded = (b: Bundle): Bundle => {
    let at = comp(b, 'entity').archetype
    let set = typeof at == 'string' ? get(at) : undefined
    let has = set ? tables(set) : []
    return has.length
      ? { ...Object.fromEntries(has.map((t) => [t, {}])), ...b }
      : b
  }

  // The id a person reads, its prefix its kind's: what a row shows and what
  // a link to it says are one spelling.
  let id = (b: Bundle): string => format(kinded(b))

  let kind = (b: Bundle) => vocab.kindOf(kinded(b)) || 'entity'

  // What an entity is called (./read.ts `called`); one not held yet, its
  // handle.
  let name = (eid: string): string => {
    let b = get(eid)
    return b ? called(b, id(b), kind(b)) : short(eid)
  }

  return {
    vocab,
    front,
    useAnswers,
    edits,
    apply: async (change) => {
      if (!box.wire) throw new Error('this inspector reaches no server')
      await box.wire.submit(change)
    },
    get,
    link: (eid) => {
      let b = get(eid)
      return pagePath(b?.entity.num ? id(b) : eid)
    },
    find: queryPath,
    go: (href) =>
      void front.mutate([
        follow(stack({ state: (eid) => front.ent(eid) }), href),
      ]),
    id,
    kind,
    name,
    when: (at) => relative(at),
  }
}
