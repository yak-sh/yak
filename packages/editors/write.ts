/**
 * The one way an editor changes the graph: a property's typed input, read and
 * checked against its declaration (@yaks/render `edit`, in the host's input
 * language), becomes a patch, and the patch goes out through the host. A
 * refusal, whether the input could not be read or the graph turned the
 * change down, is said through the host's `problem`, never thrown at the
 * editor.
 *
 * @module
 */

import { edit, type Patch } from '@yaks/render'
import { type Bundle, host } from './host.ts'

let said = (e: unknown) => e instanceof Error ? e.message : String(e)

/** Send one entity's patch, at once; resolves whether the graph took it. */
export let apply = (eid: string, patch: Patch): Promise<boolean> => {
  let { apply, problem } = host()
  let change: Bundle[] = [{ entity: { eid }, ...patch }]
  let refuse = (e: unknown) => {
    problem(said(e), eid)
    return false
  }
  try {
    return Promise.resolve(apply(change)).then(() => true, refuse)
  } catch (e) {
    return Promise.resolve(refuse(e))
  }
}

/** Write a property from what was typed or picked. Undefined when the input
 * could not be read (said already); else whether the graph took it. */
export let write = (
  eid: string,
  comp: string,
  prop: string,
  value: unknown,
): Promise<boolean> | undefined => {
  let { vocab, editing, get, problem } = host()
  let patch
  try {
    let b = get(eid) ?? { entity: { eid } }
    patch = edit(vocab, { comp, prop }, editing).run(b, value)
  } catch (e) {
    problem(said(e), eid)
    return
  }
  return apply(eid, patch)
}
