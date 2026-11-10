// What a native session asks when nothing names a model, exported alone as
// `@yaks/harness/default` so a package that requests sessions (@yaks/heal's
// fixers) reads the same default without loading the agent loop. A session
// opened on a piece of work asks what that work's project says its work runs
// on ({@link usingFor}), and the default where the project says nothing.

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

/** What a session opened on a piece of work asks: the `using{provider, model}`
 * on the project a task is filed in, or on the project itself, so the session
 * runs as that project's other work does; {@link defaultUsing} where the
 * project names no model. */
export let usingFor = async (g: Graph, work: string): Promise<Comp> => {
  let [row] = await g.get([work], ['project', 'filed', 'using'])
  let project = row?.project ? row : (await g.get(
    [String((row?.filed as Comp | undefined)?.project ?? '')].filter(Boolean),
    ['using'],
  ))[0]
  let using = project?.using as Comp | undefined
  return using?.provider && using.model ? using : await defaultUsing(g)
}
