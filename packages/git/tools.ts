// What anybody may ask of git: the `tools` facet a host takes
// (`@yaks/git/tools`) — the runs behind the `tool: true` declarations in
// ./vocab.json.
//
// `land` is the one, and it is a tool like any other. It acts on the BOX the
// call runs on rather than on the graph — the checkout standing at `ctx.cwd`,
// which on a command line is where the person typed, because `yak land`
// composes the graph and runs the tool in that same process (@yaks/cli
// local.ts). Nothing here reads or writes a row; the answer is git's own
// output, as the prose the call carries back.
//
// A DIVERGENCE IS A REFUSAL. Landing answers one of two things (./land.ts): it
// landed, or the base moved and the branch was rebased and left waiting for a
// re-gate. The second is not a landing, so it comes back as a `CallError` —
// git's whole account of it as the message — which the runner records as a
// failed execution and a command line answers with exit 1. That is the same
// pair of exit codes `land` has always had.

import type { Bundle, ToolCtx } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { CallError } from '@yaks/tools'
import { land } from './land.ts'

let str = (v: unknown): string => v == null ? '' : String(v)

/** The runs behind the tools ./vocab.json declares. */
export let runs = (): Runs => ({
  land: async (_bundles, ctx: ToolCtx): Promise<Bundle[]> => {
    if (!ctx.cwd) {
      throw new CallError(
        'cwd',
        'land acts on a checkout, and this graph runs nowhere in particular',
      )
    }
    // git's own output, as git wrote it, gathered in the order it came: the
    // answer a person reads is the account git gave, never a retelling.
    let said: string[] = []
    let outcome = await land({
      cwd: ctx.cwd,
      allow: str(ctx.args['allow-revert']).split(',').filter(Boolean),
      write: (text) => {
        let line = text.trimEnd()
        if (line) said.push(line)
      },
    })
    if (!('landed' in outcome)) throw new CallError('diverged', said.join('\n'))
    return [{
      entity: { eid: '$landed' },
      content: { body: [...said, `landed ${outcome.landed}`].join('\n') },
    }]
  },
})
