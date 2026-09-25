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
// The decider is the caller. Neither implementation writes `by` or `at`: those
// are stamped properties, filled in from the actor of the write (@yaks/graph's
// `marks`), which the tool runner sets to whoever made the call. So a decision
// records the agent that made it rather than the person it believed it was
// acting for, and an owner's approval is recorded as the owner's only when the
// owner is the one calling.

import { addressed, argsOf, type Bundle, type Comp } from '@yaks/graph'
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
  design_new: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let project = args.project == null
      ? undefined
      : (await addressed(graph, [String(args.project)]))[0]
    return [{
      entity: { eid: '$design' },
      design: {},
      doc: docIn(args),
      proposed: {},
      ...(project ? { filed: { project } } : {}),
    }]
  },

  design_decide: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let [eid] = await addressed(graph, [String(args.design)])
    return [{
      entity: { eid },
      decided: { verdict: String(args.verdict) },
    }]
  },
})
