/** The top of the home page: what CrayonBloom is in a headline
 * (`Hero.Title`) and a sentence (`Hero.Lede`), what to press
 * (`Hero.Actions`), and a picture of the thing beside them (`Hero.Visual`).
 * `Hero.Start` is the place to begin, ruled off under the actions, and
 * `Hero.Trust` a line of short reassurances, each ticked. */
import { block, type Part } from '@yaks/ui/parts'

export let Hero:
  & Part
  & Record<
    | 'Copy'
    | 'Title'
    | 'Line'
    | 'Lede'
    | 'Actions'
    | 'Start'
    | 'Note'
    | 'Trust'
    | 'Visual',
    Part
  > = block('div', 'Hero', {
    Copy: 'div',
    Title: 'h1',
    Line: 'span',
    Lede: 'p',
    Actions: 'div',
    Start: 'div',
    Note: 'p',
    Trust: 'ul',
    Visual: 'div',
  })
