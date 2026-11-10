/** A short list of what you get, each line ticked in grass green. */
import { block, type Part } from '@yaks/ui/parts'

export let Ticks: Part & Record<'Item', Part> = block('ul', 'Ticks', {
  Item: 'li',
})
