/** A controlled disclosure presents a summary Button and optional content.
 * The consumer names its page entity and keeps emitted Disclosure{open}
 * bundles, so the same state is found across remounts.
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { type Bundle, derivedEid } from '@yaks/graph'
import { Button, type Props } from '@yaks/ui'

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

/** State and presentation supplied by the disclosure's consumer. */
export type DisclosureProps = {
  e: Bundle
  onChange: (b: Bundle) => void
  summary: ComponentChildren
  /** Button presentation; disclosure supplies its action and accessibility. */
  summaryProps?: Props
  class?: string
  children?: ComponentChildren
}

/** Content mounts only while open; the summary is an ordinary accessible Button. */
export let Disclosure = (
  { e, onChange, summary, summaryProps, class: extra, children }:
    DisclosureProps,
): JSX.Element => {
  let open = isOpen(e)
  let id = `disclosure-${e.entity.eid}`
  return h(
    'section',
    { class: extra },
    h(Button, {
      ...summaryProps,
      type: 'button',
      'aria-expanded': open,
      'aria-controls': id,
      onClick: () => onChange(disclosed(e, !open)),
    }, summary),
    h('div', { id, hidden: !open }, open ? children : null),
  )
}
