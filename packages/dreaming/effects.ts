// What a server does about a dream, exported as `@yaks/dreaming/effects`: two
// watches that open one session on a dream that has come due, and nothing at
// all when the configuration names no session to open.
//
// That session is why this export takes OPTIONS. Opening one means asking a
// provider, at an effort, with a persona — an account, a model and a persona
// that exist on this machine — and none of that is a fact about the graph. So
// the configuration names what to open and this package decides when:
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
// A configuration that names no `desk` registers no watches, which is what a
// graph that only stores dreams wants — a reading list, a page of standing
// intentions — rather than a session opening on a machine with no agent on it.
//
// `rest` is parsed when the plugin is composed, deliberately: a recurrence
// this machine cannot parse would otherwise mean a dream that never rests and
// a session opened on every trigger, and boot is a cheaper place to discover
// that than the bill. It is reported at boot rather than thrown — missing or
// malformed configuration never stops the server coming up — and the plugin
// then registers nothing, which is the safe outcome for a session that would
// otherwise open every time.

import type { Watch } from '@yaks/effects'
import { next } from '@yaks/wake'
import { type Desk, watches } from './desk.ts'

/** The configuration this plugin accepts. */
export type Options = {
  /** the session to open on a dream that has come due; omitted, none opens */
  desk?: Desk
  /** how long a dream rests afterwards — a @yaks/wake recurrence */
  rest?: string
}

/** The watches to register, when the configuration named a session to
 * open. */
export let effects = (_host: unknown, options: Options = {}): Watch[] => {
  let { desk, rest } = options
  if (!desk) return []
  if (rest && next(rest, Date.now()) == null) {
    console.warn(
      `@yaks/dreaming: ${JSON.stringify(rest)} is no rest — no desk opens ` +
        `until the config says how long a dream rests`,
    )
    return []
  }
  return watches({ desk, rest })
}
