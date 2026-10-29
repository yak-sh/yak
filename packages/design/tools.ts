// The two tools this package implements: the module a server imports at
// `@yaks/design/tools` to get the implementations behind the `tool: true`
// declarations in ./vocab.json. They are the two halves of a decision: writing
// a proposal down, and settling it.
//
// Both write components that do not belong to this package, and that is the
// point. A proposal is `design{}` for what it is, @yaks/doc's
// `doc{title, body}` for its text, and @yaks/kernel's `proposed` and
// `decided` for its lifecycle — anything can be proposed, so those two belong
// to the kernel. A tool returns bundles, which are plain data, so naming
// another package's component costs no import, and a server that composes
// neither package refuses the write, naming the component it does not know.
//
// A named decider records that person's explicit decision through the kernel's
// request. The caller remains the writer used for authorization and journaling.

import type { Bundle, Comp } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import type { Runs } from '@yaks/graph/tools'

// The text a person reads. A body nobody supplied is omitted rather than
// written as an empty string — a design is written to be argued with, and the
// argument may arrive after the title.
let docIn = (args: Record<string, unknown>): Comp => ({
  title: String(args.title ?? '').trim(),
  ...(args.body == null ? {} : { body: String(args.body) }),
})

/** The implementations behind the tools ./vocab.json declares. A factory, like
 * every such module, although this one needs nothing from the server: each
 * implementation reads what it needs from the call it is handed. */
export let runs = (): Runs => ({
  design_new: (call): Bundle[] => {
    let args = argsOf(call)
    let project = args.project == null ? undefined : String(args.project)
    return [{
      entity: { eid: '$design' },
      design: {},
      doc: docIn(args),
      proposed: {},
      ...(project ? { filed: { project } } : {}),
    }]
  },

  design_decide: (call): Bundle[] => {
    let args = argsOf(call)
    return [{
      entity: { eid: String(args.design) },
      decided: { verdict: String(args.verdict) },
      ...(args.by ? { $decider: String(args.by) } : {}),
    }]
  },
})
