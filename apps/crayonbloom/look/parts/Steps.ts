/** How it goes, in order: each `Steps.Step` a card with its number big in a
 * crayon colour (`Steps.Number`), what happens (`Steps.Title`) and a line
 * about it. Three across, one under another on a phone. */
import { block, type Part } from '@yaks/ui/parts'

export let Steps: Part & Record<'Step' | 'Number' | 'Title', Part> = block(
  'ol',
  'Steps',
  { Step: 'li', Number: 'span', Title: 'h3' },
)
