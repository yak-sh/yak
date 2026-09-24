// The implementation behind `code sync` in ./vocab.json, exported as
// `@yaks/code/tools`.
//
// It reads the checkout at the calling process's `cwd` — on a command line the
// directory the command runs in — through @yaks/mirror, and writes what moved
// itself, in batches, as the caller. What it returns is only the report:
// handing a whole codebase back to the runner would make it the call's answer.

import {
  type Actor,
  argsOf,
  type Bundle,
  type Comp,
  type Graph,
  who,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { sync } from '@yaks/mirror'
import { CallError } from '@yaks/tools'
import { codeMirror } from './sync.ts'

/** Sync the checkout at `cwd` into `g`, and say what it did in one line. */
export let codeSync = async (
  g: Graph,
  cwd: string | undefined,
  opts: { full?: boolean; actor?: Actor | null } = {},
): Promise<string> => {
  if (!cwd) {
    throw new CallError(
      'cwd',
      'code sync reads a checkout, and this runs in none',
    )
  }
  let t = performance.now()
  let { binding, said, root } = await codeMirror(g, cwd, opts)
  let done = await sync(binding)
  let ms = Math.round(performance.now() - t)
  if (done.failed.length) {
    throw new CallError('sync', done.failed.join('\n'))
  }
  let gone = done.read.length - said.modules
  return [
    `${root}: read ${said.modules} files (${said.symbols} exports, ` +
    `${said.imports} imports, ${said.packages} packages)` +
    (gone ? `, cleared ${gone} gone` : '') + ` in ${ms} ms.`,
    ...said.refused.length
      ? [`deno doc could not read the exports of: ${said.refused.join(', ')}`]
      : [],
  ].join('\n')
}

/** The implementations of the tools ./vocab.json declares. */
export let runs = (): Runs => ({
  code_sync: async (call, graph): Promise<Bundle[]> => [{
    entity: { eid: '$synced' },
    content: {
      body: await codeSync(
        graph,
        (call.process as Comp | undefined)?.cwd as string | undefined,
        { full: argsOf(call).full == true, actor: who(call) },
      ),
    },
  }],
})
