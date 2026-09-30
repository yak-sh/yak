// What the person has typed in this page and not sent: their drafts
// (@yaks/draft), kept in the graph and synced to every interface they use —
// another tab, the terminal, another device — until each is sent or
// discarded. A keystroke lands here at once and waits in localStorage until
// the host has it, so a reload, a crash or a host out of reach loses nothing;
// the host takes it at a pace, through the outbox every write leaves by
// (live.ts `apply`), and merges what two interfaces type at once.
//
// Whose drafts: the person this browser acts for (its client's actor), or
// else the graph's lone person (`lone`): a terminal names no client, and a
// browser may not be bound to anyone yet. Typing before either is known is
// kept, and written once it is; a host that keeps no drafts (it composes no
// @yaks/draft) is never written to, and the page keeps them itself.
//
// `drafts` is the door every place that types goes through: the query fields
// (fields.tsx), @yaks/ux's `Edit` (the UX host, registry.ts), the terminal's
// own editing, and, through `useDraft`, the page's plain boxes — the comment
// box, a board's quick-add, an edge's search.

import { useLayoutEffect } from 'preact/hooks'
import { computed, effect, signal } from '@preact/signals'
import { type Client, desk, type Drafts, type Stash } from '@yaks/draft'
import type { Bundle } from '@yaks/graph'
import { apply, capable, config, holdQuery, myActor, row } from '../live.ts'
import { parseQuery } from '../query.ts'
import { rows } from './hits.ts'

let only = signal<string | undefined>()

/** Ask the host for the graph's lone person, whom a page no actor names
 * types as; a graph of several, or none, names nobody. The page's entry
 * asks once, after boot. */
export let lone = (): Promise<void> =>
  rows('.person', 2).then((people) => {
    only.value = people.length == 1 ? people[0].entity.eid : undefined
  }).catch(() => {})

let me = () => capable('draft') ? myActor() ?? only.value : undefined

// The host's graph, as a desk reads and writes it: the person's drafts held
// by a subscription, each row as the cache has it.
let host: Client = {
  mutate: apply,
  watch: (query) => {
    let ids = holdQuery(parseQuery(query))
    let held = computed(() =>
      ids.value.flatMap((eid): Bundle[] => {
        let draft = row(eid).value?.draft
        return draft ? [{ entity: { eid }, draft }] : []
      })
    )
    return {
      get value() {
        return held.value
      },
      subscribe: (fn) => effect(() => fn(held.value)),
    }
  },
}

// A browser's own storage, where it lets a page have it; a terminal's is
// Deno's. Without a host (a test) nothing is kept past the process.
let stash = (): Stash | undefined => {
  if (!config.host) return undefined
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

// Bound on first use, once the page knows its host.
let bound: ReturnType<typeof desk> | undefined
let desked = () =>
  bound ??= desk(host, {
    by: me,
    stash: stash(),
    report: (err) => console.warn('drafts:', err),
  })

/** The person's drafts, by the place they are typed in. */
export let drafts: Drafts = {
  text: (place) => desked().text(place),
  type: (place, text) => desked().type(place, text),
  spend: (place, also) => desked().spend(place, also),
}

// Wire a plain box to its draft: give useDraft a stable key and the box's
// ref, and every keystroke is kept, the box shows the draft wherever it was
// typed (a reload, another tab, the terminal) and as it changes there, and
// `spend` ends it, in one change with the send it went into. The box stays
// uncontrolled, the element owning the text while it is typed in; `seed`
// mirrors a shown or typed line into whatever its host derives from it (the
// board's chips, the composer's hints). An empty key is a no-op, so a box
// that only exists once a verb opens it can pass '' until it does.
type Box = HTMLInputElement | HTMLTextAreaElement
export let useDraft = (
  key: string,
  ref: { current: Box | null },
  seed?: (v: string) => void,
): {
  text: string
  sync: (el: Box) => void
  spend: (also?: Bundle[]) => void
} => {
  let text = key ? drafts.text(key) : ''
  useLayoutEffect(() => {
    let el = ref.current
    if (!el || el.value == text) return
    let at = Math.min(el.selectionStart ?? text.length, text.length)
    el.value = text
    if (el.ownerDocument.activeElement == el) el.setSelectionRange(at, at)
    seed?.(text)
  }, [text])
  return {
    text,
    sync: (el: Box) => {
      if (!key) return
      drafts.type(key, el.value)
      seed?.(el.value)
    },
    spend: (also?: Bundle[]) =>
      key ? drafts.spend(key, also) : also?.length && void apply(also),
  }
}
