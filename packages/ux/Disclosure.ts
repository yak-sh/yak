/** A controlled disclosure is the kit's fold, `More`: a `details` whose
 * summary opens what it holds. The consumer names its page entity and keeps
 * emitted Disclosure{open} bundles, so the same state is found across
 * remounts, and `DisclosureMark` is a second way to open it.
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { More } from '@yaks/ui/parts'

/** The page entity carrying this owner's disclosure state. */
export let disclosureAt = (owner: string): string =>
  derivedEid(['Disclosure', owner].join('|'))

/** Missing disclosure state is closed. */
export let isOpen = (e?: Bundle): boolean =>
  (e?.Disclosure as { open?: boolean } | undefined)?.open === true

/** The bundle emitted when this disclosure is opened or closed. */
export let disclosed = (e: Bundle, open: boolean): Bundle => ({
  entity: { eid: e.entity.eid },
  Disclosure: { open },
})

/** Where a disclosure's state is, and where what it emits goes. Without a
 * page entity (`e`) it is a plain `details`, which its host opens itself. */
export type Disclosed = {
  e?: Bundle
  onChange?: (b: Bundle) => void
}

/** State and presentation supplied by the disclosure's consumer. */
export type DisclosureProps = Disclosed & {
  summary: ComponentChildren
  /** its summary's own attributes: a `class`, a `data-` name to find it by */
  summaryProps?: Record<string, unknown>
  /** the fold's look: `quiet` for a step, `on` running, `no` failed */
  mod?: string | (string | false | null | undefined)[]
  class?: string
  /** what it holds is drawn only while open, for content that asks for
   * rows; closed, the server's page then has nothing to open */
  lazy?: boolean
  children?: ComponentChildren
}

// The id of what a disclosure holds, which its summary and marks control.
let bodyOf = (e: Bundle) => `disclosure-${e.entity.eid}`

// Pressing its summary or a mark emits the other state; the page draws it
// open or closed from what its owner supplies again.
let pressed = ({ e, onChange }: Disclosed) =>
  e && onChange
    ? (ev: Event) => {
      ev.preventDefault()
      onChange(disclosed(e, !isOpen(e)))
    }
    : undefined

/** Open as its state says; what it holds is drawn whether open or not, so a
 * page drawn on a server opens it with no script, unless it is `lazy`. */
export let Disclosure = (
  { e, onChange, summary, summaryProps, mod, class: extra, lazy, children }:
    DisclosureProps,
): JSX.Element => {
  let open = isOpen(e)
  return h(
    More,
    {
      mod,
      class: extra,
      open,
      ...e ? { 'data-disclosure': e.entity.eid } : {},
    },
    h(
      More.Summary,
      { ...summaryProps, onClick: pressed({ e, onChange }) },
      summary,
    ),
    h(
      More.Body,
      e ? { id: bodyOf(e) } : {},
      lazy && !open ? null : children,
    ),
  )
}

/** A second way to open a disclosure, drawn outside it: a button over the
 * same state, its own words in `children`. */
export let DisclosureMark = (
  { e, onChange, children, ...props }: Disclosed & {
    children?: ComponentChildren
    [attribute: string]: unknown
  },
): JSX.Element =>
  h(More.Mark, {
    ...props,
    type: 'button',
    'aria-expanded': String(isOpen(e)),
    ...e
      ? { 'aria-controls': bodyOf(e), 'data-disclosure-mark': e.entity.eid }
      : {},
    onClick: pressed({ e, onChange }),
  }, children)
