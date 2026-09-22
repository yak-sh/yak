// What an agent can ask for here, exported as `@yaks/persona/tools`: the
// implementation behind the `persona_read` declaration in ./vocab.json. One
// tool, because this package does one thing — render a persona.
//
// It returns text — a `content{body}` entity with `output{source}` naming the
// call it came from (@yaks/tools' components, the shape every transport
// already renders) — not a file and not a path. An agent that asked for a
// persona gets the text; a caller that wants it on disk writes it there
// itself, which is the whole reason this package renders text.

import { type Bundle, Refused, type ToolCtx } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { voice } from './voice.ts'
import { wear } from './worn.ts'

// The persona the caller typed, resolved to an eid: an eid resolves to itself,
// and a name resolves to whatever the graph addresses it to (@yaks/alias, when
// it is composed in) — the same resolution `graph_show` performs, so a persona
// is reachable here by every name it is reachable by there.
let at = async (ctx: ToolCtx, said: string): Promise<string> => {
  let found = await ctx.graph.address([said])
  return found.get(said) ?? said
}

/** The implementations behind the tools ./vocab.json declares. A factory,
 * like every other plugin export, though this one needs nothing from the
 * server: a persona is read through the graph the call arrived on. */
export let runs = (): Runs => ({
  persona_read: async (_bundles, ctx): Promise<Bundle[]> => {
    let said = String(ctx.args.persona ?? '').trim()
    if (!said) throw new Refused('persona_read needs a persona')
    let worn = await wear(ctx.graph.storage, ctx.graph.vocab)(
      await at(ctx, said),
    )
    // An entity that is not a persona is refused rather than rendered as an
    // empty document: a caller that named a task would otherwise read the
    // task's own body as instructions.
    if (!worn) throw new Refused(`no persona called ${said}`)
    return [{
      entity: { eid: '$voice' },
      content: { body: voice(ctx.graph.vocab)(worn) },
      output: { source: ctx.call },
    }]
  },
})
