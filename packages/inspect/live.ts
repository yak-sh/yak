/**
 * The inspector's host over a server's graph: what a page (./main.ts) and a
 * terminal (./tui.ts) both supply its views, built on a @yaks/client box
 * connected to that server (@yaks/sync over @yaks/api's `/ws` and `/apply`),
 * and the page's own graph beside it for the inspector's state.
 *
 * What a view asks is a server-evaluated watch held while the view is
 * mounted, each row whole; an aggregate is the watch's `reduced`, and one
 * asked `once` is kept as it first came and its watch closed. A write goes to
 * the server as it stands, so the graph resolves what a person typed (an id,
 * a `$` alias, an edge's eid), and comes back as it was applied.
 *
 * `here` draws what an address (./where.ts) names.
 *
 * @module
 */

import { type Signal, signal } from '@preact/signals'
import { type FunctionComponent, h } from 'preact'
import { useLayoutEffect, useState } from 'preact/hooks'
import type { Client, Watch } from '@yaks/client'
import { aggregate, dead, type Reduced } from '@yaks/graph'
import { human, short } from '@yaks/id'
import { parse } from '@yaks/query'
import { relative } from '@yaks/ui'
import type { Inspector } from './door.ts'
import type { Answer, Ask, Asks, Bundle, Front, Host } from './host.ts'
import { MAP, opened } from './Map.ts'
import { type At, mapPath, pagePath } from './where.ts'

/** The line that holds one entity whole, by any id the graph resolves. */
export let entityLine = (id: string): string => `entity.eid=${id}&*`

// A line's rows carry every component, so a view draws an entity by whatever
// it wears: `*`, unless the line already says what it answers (a projection),
// or answers no rows at all (an aggregate).
let whole = (line: string, agg: boolean): string =>
  agg || /(^|&)(\*|\.fields=[^&]*)(&|$)/.test(line)
    ? line
    : line
    ? `${line}&*`
    : '*'

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
  /** the query field, bound to `front` (@yaks/filter) */
  Bar: Host['Bar']
}

/** The host over `box`. */
export let live = ({ box, front, edits, Bar }: LiveOpts): Host => {
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

  let hold = (a: Ask): Held => {
    let line = typeof a == 'string' ? a : a.query
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
    let w: Watch | undefined = box.watch(whole(line, agg), {
      evaluate: 'server',
    })
    // Asked once: the first answer is kept, and nothing is asked again.
    let kept = signal<Reduced | undefined>(undefined)
    let off = typeof a != 'string' && a.once && agg
      ? w.subscribe(() => {
        if (!w?.reduced) return
        kept.value = w.reduced
        drop()
      })
      : undefined
    let drop = () => {
      off?.()
      w?.close()
      w = undefined
    }
    return {
      answer: () => {
        let error = w?.refused
        if (agg) {
          let r = kept.value ?? w?.reduced
          return { rows: [], ready: !!r, error, ...reading(r) }
        }
        return { rows: w?.value ?? [], ready: !!w?.ready, error }
      },
      drop,
    }
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
    find: mapPath,
    id,
    kind: (b) => vocab.kindOf(b) || 'entity',
    name,
    when: (at) => relative(at),
    Bar,
  }
}

/**
 * What an address draws, over a host and its inspector: the map, with the
 * address's line run in its bar (`put` writes a field's text, @yaks/filter
 * `set`), or the page of the entity its id names.
 */
export let here = (
  host: Host,
  { Door, io }: Inspector,
  put: (field: string, text: string) => void,
): FunctionComponent<{ where: At }> => {
  let Mapped = ({ query }: { query?: string }) => {
    useLayoutEffect(() => {
      host.front.mutate(opened(host.front.ent, query))
      if (query != null) put(MAP, query)
    }, [query])
    let map = io.state(MAP)
    return map ? h(Door, { e: map, view: 'Inspect.Full' }) : null
  }
  let Page = ({ id }: { id: string }) => {
    let { it } = host.useAnswers({ it: entityLine(id) })
    let [e] = it.rows
    return e
      ? h(Door, { e, view: 'Inspect.Full' })
      : it.ready || it.error
      ? h('p', null, it.error ?? `${id} names nothing.`)
      : null
  }
  return ({ where }) =>
    'id' in where
      ? h(Page, { id: where.id })
      : h(Mapped, { query: where.query })
}
