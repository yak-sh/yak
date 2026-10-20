// What a native session asks when nothing names a model, exported alone as
// `@yaks/harness/default` so a package that requests sessions (@yaks/heal's
// fixers) reads the same default without loading the agent loop.

import type { Comp, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { CallError } from '@yaks/tools/errors'

/** The native harness's own entity, @yaks/code's row for this package: its
 * eid is derived from the package's name, so every graph names it alike. */
export let HARNESS: string = identityEid('package', ['@yaks/harness'])

/** What a native session asks when nothing names it: the `using{provider,
 * model}` on {@link HARNESS}, so one write changes it and no release does. */
export let defaultUsing = async (g: Graph): Promise<Comp> => {
  let [row] = await g.get([HARNESS], ['using'])
  let using = row?.using as Comp | undefined
  if (!using?.provider || !using.model) {
    throw new CallError(
      'model',
      `Choose a model: no default using{provider, model} on ${HARNESS}`,
    )
  }
  return using
}
