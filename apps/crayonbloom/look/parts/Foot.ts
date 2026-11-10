/** The footer every page wears: the name and what it is, columns of places
 * to go under a `Foot.Heading` each, and the fine print along the bottom. */
import { block, type Part } from '@yaks/ui/parts'

export let Foot:
  & Part
  & Record<
    'Inner' | 'About' | 'Cols' | 'Col' | 'Heading' | 'Link' | 'Fine',
    Part
  > = block('footer', 'Foot', {
    Inner: 'div',
    About: 'div',
    Cols: 'div',
    Col: 'nav',
    Heading: 'h2',
    Link: 'a',
    Fine: 'p',
  })
