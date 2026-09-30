// The query field (@yaks/filter), bound to this page. Every query typed here
// (a card's filter bar, the search palette, the command line, a board's query,
// the inspector's bar) is a field in `front`, the page's own graph: a local
// @yaks/client over RAM that no server hears of, where the inspector
// (@yaks/inspect) and every UX component (@yaks/ux) keep their state too.
// Anything on the page reads what is typed in one by reading its row. What is
// typed in the page's plain boxes is there too, as a `draft` (../front.json).
// All of it that is `durable: tab` comes back when the tab reloads, and none of
// it in a new tab; in the terminal the tab is the process.
//
// What a field cannot know is supplied here, once: the vocabulary the host
// taught this page (read when a field completes, since it is learned after
// this module loads), the entities this page holds for a reference to name,
// the wells a property's values come from, the rankings the host evaluates,
// and, in a browser, the overlay the list floats in, clear of every clipping
// card. The terminal binds the same fields with the list in the flow.
import { useEffect } from 'preact/hooks'
import { client } from '@yaks/client'
import { derivedEid } from '@yaks/graph'
import { filters, type Float } from '@yaks/filter'
import { docs as filterDocs } from '@yaks/filter/vocab'
import { docs as inspectDocs } from '@yaks/inspect/front'
import { docs as uxDocs } from '@yaks/ux/vocab'
import type { Cand, Source } from '@yaks/query'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import own from '../front.json' with { type: 'json' }
import { cache, type Comps } from '../live.ts'
import { RANKS } from '../query.ts'
import { idOf, kindOf, vocab } from '../types.ts'
import { Float as Floating } from '@yaks/ui'
import { wellOf, wells } from './wells.ts'

/** The page's own graph. */
export let front = client(
  loadVocab([...filterDocs, ...uxDocs, ...inspectDocs, own as VocabDoc]),
  [],
  { vault: false, wireVault: false },
)

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
  <Floating anchor={anchor} side='below'>{children}</Floating>
)

/** The fields as a browser shows them. */
export let fields = bind(Below)

// A plain box's draft is an entity of its own, named by the box's key.
let drafting = (key: string) => derivedEid(['draft', key].join('|'))

/** What is typed in the plain box `key` names, and not yet sent. */
export let drafted = (key: string): string =>
  String((front.ent(drafting(key))?.draft as { text?: string })?.text ?? '')

// Keep a box's text, or, emptied, keep nothing.
let draft = (key: string, text: string) => {
  if (!text && !drafted(key)) return
  front.mutate([{
    entity: { eid: drafting(key) },
    draft: text ? { text } : null,
  }])
}

// Wire a plain box to its draft: give useDraft a stable key and the box's
// ref, and every keystroke is kept, the next mount (a card reopened, the tab
// reloaded) puts the text back, and sending it or Escape spends it. The box
// stays uncontrolled, the element owning the text while it is typed in;
// `seed` mirrors a restored or typed line into whatever its host derives from
// it (the board's chips, the composer's hints). An empty key is a no-op, so a
// box that only exists once a verb opens it can pass '' until it does.
type Box = HTMLInputElement | HTMLTextAreaElement
export let useDraft = (
  key: string,
  ref: { current: Box | null },
  seed?: (v: string) => void,
): { sync: (el: Box) => void; spend: () => void } => {
  useEffect(() => {
    let el = ref.current
    let v = key && drafted(key)
    if (!el || !v) return
    el.value = v
    seed?.(v)
  }, [])
  return {
    // onInput: keep the line and mirror it in one call.
    sync: (el: Box) => {
      if (!key) return
      draft(key, el.value)
      seed?.(el.value)
    },
    spend: () => key && draft(key, ''),
  }
}
