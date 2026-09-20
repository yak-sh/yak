// What anybody may ask of the base words: the `tools` facet a host takes
// (`@yaks/kernel/tools`) — the runs behind the `tool: true` declarations in
// ./vocab.json.
//
// One word lives here, and it is the one people type all day: a comment. A
// comment is not a table of its own — it is `doc{body}` aimed by
// `comment{target}` — so the tool writes two components on one new entity and
// the runner signs it as whoever asked.

import { addressed, type Bundle, type ToolCtx } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'

/** The runs behind the tools ./vocab.json declares. */
export let runs: Runs = {
  comment_new: async (_bundles, ctx: ToolCtx): Promise<Bundle[]> => {
    let [target] = await addressed(ctx.graph, [String(ctx.args.target)])
    return [{
      entity: { eid: '$comment' },
      doc: { body: String(ctx.args.body) },
      comment: { target },
    }]
  },
}
