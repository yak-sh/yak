// The implementations of the tools declared with `tool: true` in ./vocab.json,
// exported as `@yaks/kernel/tools` — the entry point a server imports to
// register them.
//
// There is one, and it is the one people call all day: a comment. A comment has
// no table of its own — it is `doc{body}` aimed by `comment{target}` — so the
// tool returns one new entity carrying both components, and the tool runner
// commits it signed as whoever called it.

import { argsOf, type Bundle } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'

/** The implementations of the tools ./vocab.json declares. A function that
 * builds them, the way every entry point here is, though this one needs nothing
 * from the server: what an implementation reads arrives on the call it is
 * handed. */
export let runs = (): Runs => ({
  comment_new: (call): Bundle[] => {
    let args = argsOf(call)
    return [{
      entity: { eid: '$comment' },
      doc: { body: String(args.body) },
      comment: { target: String(args.target) },
    }]
  },
})
