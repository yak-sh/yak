/** What a section says first: a `Kicker` over its heading (`Lead.Title`)
 * over a `Lead.Lede`, the sentence or two that set it up. `Lead-page` is a
 * page's own, its title the page's `h1`. */
import { block, type Part } from '@yaks/ui/parts'

export let Lead: Part & Record<'Title' | 'Lede', Part> = block('div', 'Lead', {
  Title: 'h2',
  Lede: 'p',
})
