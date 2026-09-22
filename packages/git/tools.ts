// The implementations behind the `tool: true` declarations in ./vocab.json,
// exported as `@yaks/git/tools`.
//
// `land` is the only one, and it is an ordinary tool. It acts on the machine
// the call runs on rather than on the graph: the checkout at `ctx.cwd`, which
// on a command line is the directory the person ran the command in, because
// `yak land` builds the graph and calls the tool in that same process
// (@yaks/cli local.ts). Nothing here reads or writes a row; the result is
// Git's own output, returned as the text of the call's answer.
//
// A diverged base is A failure. Landing ends in one of two ways (./land.ts):
// it landed, or the base moved and the branch was rebased and left waiting for
// its tests to be re-run. The second is not a landing, so it is thrown as a
// `CallError` carrying Git's whole account of it as the message, which the
// tool runner records as a failed call and a command line reports as exit 1.
// Those are the same two exit codes `land` has always had.

import type { Bundle, ToolCtx } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { CallError } from '@yaks/tools'
import { land } from './land.ts'

let str = (v: unknown): string => v == null ? '' : String(v)

/** The implementations of the tools ./vocab.json declares. */
export let runs = (): Runs => ({
  land: async (_bundles, ctx: ToolCtx): Promise<Bundle[]> => {
    if (!ctx.cwd) {
      throw new CallError(
        'cwd',
        'land acts on a checkout, and this graph runs nowhere in particular',
      )
    }
    // Git's output, exactly as Git wrote it, collected in the order it
    // arrived: what the caller reads is Git's own account, not a summary of
    // it.
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
