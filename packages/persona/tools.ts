// What an agent may ASK for here: the `tools` facet a host takes
// (`@yaks/persona/tools`) — the run behind the `persona_read` declaration in
// ./vocab.json. One tool, because there is one act: a persona, said.
//
// It answers PROSE — a `content{body}` entity saying which call it came from
// (@yaks/tools' words, the shape every door already renders) — and not a file
// and not a path. An agent that asked for a voice gets the voice; a host that
// wants it on disk writes it there itself, which is the whole reason this
// package renders text.

import { type Bundle, Refused, type ToolCtx } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { voice } from './voice.ts'
import { wear } from './worn.ts'

// The persona somebody typed, as an eid: an id that is an entity is itself,
// and a name is whatever the graph says it addresses (@yaks/alias, where a
// host composes it in) — the same resolution `graph_show` does, so a persona
// is reachable here by every spelling it is reachable by there.
let at = async (ctx: ToolCtx, said: string): Promise<string> => {
  let found = await ctx.graph.address([said])
  return found.get(said) ?? said
}

/** The runs behind the tools ./vocab.json declares. A factory, as every facet
 * is, though this one needs nothing from the host: a persona is read through
 * the graph the call arrives on. */
export let runs = (): Runs => ({
  persona_read: async (_bundles, ctx): Promise<Bundle[]> => {
    let said = String(ctx.args.persona ?? '').trim()
    if (!said) throw new Refused('persona_read needs a persona')
    let worn = await wear(ctx.graph.storage, ctx.graph.vocab)(
      await at(ctx, said),
    )
    // Not a persona is a refusal rather than an empty document: a caller that
    // named a task would otherwise read the task's own body as a voice.
    if (!worn) throw new Refused(`no persona called ${said}`)
    return [{
      entity: { eid: '$voice' },
      content: { body: voice(ctx.graph.vocab)(worn) },
      output: { source: ctx.call },
    }]
  },
})
