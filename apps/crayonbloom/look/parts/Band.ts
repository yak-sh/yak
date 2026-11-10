/** A section of a page, as wide as the window, what it holds kept to the
 * page's width in `Band.Inner`. Plain, it is the paper; `Band-mint`,
 * `Band-blush` and `Band-butter` wash it in a tint. `Band-first` sits right
 * under the header,
 * `Band-center` centres what it says and `Band-narrow` keeps it to a
 * reading column. `Band.Split` sets a picture beside words, one over the
 * other on a phone. */
import { block, type Part } from '@yaks/ui/parts'

export let Band: Part & Record<'Inner' | 'Split', Part> = block(
  'section',
  'Band',
  { Inner: 'div', Split: 'div' },
)
