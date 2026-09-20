// What a host DOES about a dream: the `effects` facet
// (`@yaks/dreaming/effects`) — two watches that open one desk on a dream that
// has come back, and nothing at all where no desk was named.
//
// The desk is the reason this facet takes OPTIONS. Opening one means asking a
// provider, at an effort, in a voice — an account, a model, a persona that
// exists on THIS box — and none of that is a fact about the graph. So the
// config names what opens and this package says when:
//
// ```json
// { "use": "@yaks/dreaming",
//   "with": { "desk": { "provider": "Y-openai",
//                       "model": "O-gpt-6",
//                       "effort": "high",
//                       "persona": "N-scribe",
//                       "actor": "N-scribe",
//                       "ask": "Write up what is waiting." },
//             "rest": "1h" } }
// ```
//
// A host that names no desk gets no watch, which is what a graph that only
// KEEPS dreams wants — a reading list, a page of standing intentions — rather
// than a transcript opening on a box with no agent on it.
//
// `rest` is read at compose time on purpose: a recurrence this box cannot
// read would otherwise be a dream that never rests, one desk per stir, and the
// place to find that out is the boot rather than the bill.

import type { Watch } from '@yaks/effects'
import { next } from '@yaks/wake'
import { type Desk, watches } from './desk.ts'

/** What a config says to this plugin. */
export type Options = {
  /** what opens on a dream that has come back; none, and none opens */
  desk?: Desk
  /** how long a dream rests afterwards — a @yaks/wake recurrence */
  rest?: string
}

/** The watches, where a desk was named. */
export let effects = (_host: unknown, options: Options = {}): Watch[] => {
  let { desk, rest } = options
  if (!desk) return []
  if (rest && next(rest, Date.now()) == null) {
    throw new Error(`@yaks/dreaming: ${JSON.stringify(rest)} is no rest`)
  }
  return watches({ desk, rest })
}
