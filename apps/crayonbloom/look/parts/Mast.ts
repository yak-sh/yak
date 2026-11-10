/** The header every page wears: the bloom and the name on the left, where
 * to go on the right. It stays on top as the page scrolls. `Mast.Link`
 * marks the page it names with `aria-current`. */
import { block, type Part } from '@yaks/ui/parts'

export let Mast:
  & Part
  & Record<'Inner' | 'Brand' | 'Mark' | 'Name' | 'Nav' | 'Link', Part> = block(
    'header',
    'Mast',
    {
      Inner: 'div',
      Brand: 'a',
      Mark: 'img',
      Name: 'strong',
      Nav: 'nav',
      Link: 'a',
    },
  )
