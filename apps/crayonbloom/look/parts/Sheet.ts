/** A coloring page, shown as the sheet of paper it is: the drawing
 * (`Sheet.Art`, holding its `Sheet.Line` art) on a white page inked round,
 * what it is under it (`Sheet.Title`, and the idea it came from in
 * `Sheet.Caption`). `Sheet-taped` is one taped up to look at, a little
 * crooked. A sheet that has been colored in holds a `Sheet.Color` over its
 * line art, which shows under the pointer or the keyboard, and a
 * `Sheet.Hint` saying so. `Sheet.Wait` stands where a drawing will be. */
import { block, type Part } from '@yaks/ui/parts'

export let Sheet:
  & Part
  & Record<
    'Art' | 'Line' | 'Color' | 'Hint' | 'Wait' | 'Title' | 'Caption',
    Part
  > = block('figure', 'Sheet', {
    Art: 'div',
    Line: 'img',
    Color: 'img',
    Hint: 'span',
    Wait: 'p',
    Title: 'strong',
    Caption: 'figcaption',
  })
