// What anybody may ask about a proposal: the `tools` facet a host takes
// (`@yaks/design/tools`) — the runs behind the `tool: true` declarations in
// ./vocab.json. Two words, and they are the two halves of a decision: writing
// one down, and settling it.
//
// Both write components that are not this package's, and that is the point. A
// proposal is `design{}` for what it is, @yaks/doc's `doc{title, body}` for
// what it says, and @yaks/kernel's `proposed`/`decided` marks for its
// lifecycle — anything can be proposed, so the marks are the kernel's. A tool
// answers BUNDLES, which are data, so naming a neighbour's word costs no
// import and a host composing neither has those columns dropped at the door.
//
// THE DECIDER IS THE CALLER. Neither run writes `by` or `at`: they are stamped
// columns, filled from the batch's own actor (@yaks/graph `marks`), which the
// runner signs as whoever wrote the call. So a decision records the agent that
// made it rather than the person on whose behalf it thought it was acting, and
// an owner's approval is recorded as the owner's only when the owner is the
// one calling.

import { addressed, type Bundle, type Comp, type ToolCtx } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'

// The words a person reads. A body nobody wrote is left off rather than
// blanked — a design is written to be argued with, and the argument may arrive
// after the title.
let docIn = (ctx: ToolCtx): Comp => ({
  title: String(ctx.args.title ?? '').trim(),
  ...(ctx.args.body == null ? {} : { body: String(ctx.args.body) }),
})

/** The runs behind the tools ./vocab.json declares. A factory, as every facet
 * is, though this one needs nothing from the host: what a run reads arrives on
 * the call's own context. */
export let runs = (): Runs => ({
  design_new: async (_bundles, ctx): Promise<Bundle[]> => {
    let project = ctx.args.project == null
      ? undefined
      : (await addressed(ctx.graph, [String(ctx.args.project)]))[0]
    return [{
      entity: { eid: '$design' },
      design: {},
      doc: docIn(ctx),
      proposed: {},
      ...(project ? { filed: { project } } : {}),
    }]
  },

  design_decide: async (_bundles, ctx): Promise<Bundle[]> => {
    let [eid] = await addressed(ctx.graph, [String(ctx.args.design)])
    return [{
      entity: { eid },
      decided: { verdict: String(ctx.args.verdict) },
    }]
  },
})
