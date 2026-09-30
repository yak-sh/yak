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
 * edge's eid), and comes back as it was applied. A row pressed is shown
 * beside the page (./state.ts `picked`).
 *
 * @module
 */

import { type Signal, signal } from '@preact/signals'
import { useLayoutEffect, useState } from 'preact/hooks'
import type { Client, Watch } from '@yaks/client'
import { aggregate, dead, type Reduced } from '@yaks/graph'
import { human, short } from '@yaks/id'
import { parse } from '@yaks/query'
import { relative } from '@yaks/ui'
import type { Answer, Ask, Asks, Bundle, Front, Host } from './host.ts'
import { picked } from './state.ts'
import { pagePath, queryPath } from './where.ts'

// One ask held: its answer as it stands, and letting it go.
type Held = { answer: () => Answer; drop: () => void }

let PENDING: Answer = { rows: [], ready: false }

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
  let id = human(vocab)

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
    return Object.fromEntries(
      Object.keys(asks).map((n) => [n, now.get(n)?.answer() ?? PENDING]),
    )
  }

  // What an entity is called: its title, or the id a person reads.
  let name = (eid: string): string => {
    let b = get(eid)
    let title = (b?.doc as { title?: unknown } | undefined)?.title
    return typeof title == 'string' && title ? title : b ? id(b) : short(eid)
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
    pick: (eid) => void front.mutate(picked(eid)),
    id,
    kind: (b) => vocab.kindOf(b) || 'entity',
    name,
    when: (at) => relative(at),
  }
}
