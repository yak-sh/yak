/** A little pill beside a name: a level, the points to spend, who is
 * talking. Calling, it is gold: something waits to be spent. Anything else
 * an element takes passes to it. */
import { type Colors, el, type Props, type Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { Fragment, h } from 'preact'

let Badge = el('span', 'ValeBadge')
export let ValeBadge = (
  { calling, ...props }: Props & { calling?: boolean },
) => h(Badge, { ...props, mod: calling && 'call' })
export let description = 'A pill beside a name, gold while it asks for use.'
export let sheet = (c: Colors): Sheet => ({
  ValeBadge: { fg: c.bg, bg: c.accent },
  'ValeBadge-call': { fg: c.text, bg: c.caution, bold: true },
})
let sample = (props: Parameters<typeof ValeBadge>[0]) =>
  h(Fragment, {}, h(ValeBadge, props))
export let specimens = (): Specimen[] => [
  ['Level', sample({ children: 'Level 5' })],
  ['Calling', sample({ calling: true, children: 'Level 5 · ✦ 2' })],
]
