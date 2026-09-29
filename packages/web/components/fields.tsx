// The query field (@yaks/filter), bound to this page. Every query typed here
// (a card's filter bar, the search palette, the command line, a board's query,
// the inspector's bar) is a field in `front`, the page's own graph: a local
// @yaks/client over RAM that no server hears of, where the inspector
// (@yaks/inspect) keeps its state too. Anything on the page reads what is
// typed in one by reading its row.
//
// What a field cannot know is supplied here, once: the vocabulary the host
// taught this page (read when a field completes, since it is learned after
// this module loads), the entities this page holds for a reference to name,
// the wells a property's values come from, the rankings the host evaluates,
// and, in a browser, the overlay the list floats in, clear of every clipping
// card. The terminal binds the same fields with the list in the flow.
import { client } from '@yaks/client'
import { filters, type Float } from '@yaks/filter'
import { docs as filterDocs } from '@yaks/filter/vocab'
import { docs as inspectDocs } from '@yaks/inspect/vocab'
import type { Cand, Source } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { cache, type Comps } from '../live.ts'
import { RANKS } from '../query.ts'
import { idOf, kindOf, vocab } from '../types.ts'
import { Overlay } from './overlay.tsx'
import { wellOf, wells } from './wells.ts'

/** The page's own graph. */
export let front = client(loadVocab([...filterDocs, ...inspectDocs]), [], {
  vault: false,
  wireVault: false,
})

let starts = (s: string, pre: string) =>
  s.toLowerCase().startsWith(pre.toLowerCase())

// The entities this page holds, as the ids a person types: listed once per
// turn of the cache, not once per keystroke.
let listed: { of?: Record<string, Comps>; ids: Cand[] } = { ids: [] }
let held = () => {
  let now = cache.peek()
  if (listed.of != now) {
    listed = {
      of: now,
      ids: Object.entries(now).map(([eid, comps]) => ({
        text: idOf({ eid, kind: kindOf(comps), num: comps.entity?.num }),
        kind: kindOf(comps),
      })),
    }
  }
  return listed.ids
}

/** What only this page's graph can answer, as the field asks it. */
export let source: Source<Cand[]> = {
  ids: (ref, pre) =>
    held().filter((c) =>
      (ref == 'entity' || c.kind == ref) && starts(c.text, pre)
    ),
  values: (comp, prop, pre) => {
    let well = wellOf(comp, prop)
    return (wells[well]?.() ?? []).filter((v) => starts(v, pre))
      .map((text) => ({ text, kind: well }))
  },
  ranks: RANKS,
}

/** The fields, with the list floating where `Float` puts it. */
export let bind = (Float?: Float) =>
  filters(front, {
    get vocab() {
      return vocab
    },
    source,
    Float,
  })

// A browser floats the list under its field.
let Below: Float = ({ anchor, children }) => (
  <Overlay anchor={anchor} side='below'>{children}</Overlay>
)

/** The fields as a browser shows them. */
export let fields = bind(Below)
