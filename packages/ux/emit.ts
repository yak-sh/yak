/**
 * The one way an `Edit` says anything: what was typed or picked, read as the
 * property's type (@yaks/render `edit`, in the host's input language), is the
 * bundle it was handed with that value changed, and goes to its caller's
 * `onChange`, or the host's `write`. Input that cannot be read goes the same
 * way as a `Refused` event, never thrown at the component.
 *
 * @module
 */

import { edit } from '@yaks/render'
import type { Bundle, Host } from './host.ts'
import { canEdit } from './read.ts'
import { changed, refused } from './state.ts'

/** Where an `Edit` sends what it emits: its caller's, or else the host's. */
export type OnChange = (b: Bundle) => unknown

let said = (e: unknown) => e instanceof Error ? e.message : String(e)

/** `input` for `comp.prop` of `e`, as the bundle it becomes: read against the
 * declaration where a client may write the property, and passed as it is to a
 * caller that owns a derived one (a status its caller turns into marks). */
export let reading = (
  host: Pick<Host, 'vocab' | 'editing'>,
  e: Bundle,
  comp: string,
  prop: string,
  input: unknown,
): Bundle =>
  canEdit(host.vocab, comp, prop)
    ? {
      entity: { eid: e.entity.eid },
      ...edit(host.vocab, { comp, prop }, host.editing).run(e, input),
    }
    : changed(e, comp, prop, input)

/** Emit `input` for `comp.prop` of `e`: the changed bundle, or the refusal. */
export let emit = (
  host: Host,
  onChange: OnChange | undefined,
  e: Bundle,
  comp: string,
  prop: string,
  input: unknown,
): void => {
  let send = onChange ?? host.write
  let b: Bundle
  try {
    b = reading(host, e, comp, prop, input)
  } catch (err) {
    return void send(refused(e, said(err)))
  }
  send(b)
}
