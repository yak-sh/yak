/** An embedded page with its address and a choice of views. @module */
import type { Sheet } from '@yaks/tui/theme'
import { Check } from './Check.ts'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** An embedded page with its address and a choice of views. */
export let Preview:
  & Part
  & Record<'Address' | 'Frame' | 'Choices' | 'Item' | 'Choice' | 'View', Part> =
    block(
      'section',
      'Preview',
      {
        Address: 'a',
        Frame: 'iframe',
        Choices: 'div',
        Item: 'div',
        Choice: Check,
        View: 'div',
      },
    )
/** What this part presents. */
export let description =
  'An embedded page with its address and a choice of views.'
/** The same parts in a terminal. */
export let sheet = (c: Colors): Sheet => ({
  Preview: { col: true },
  Preview_Address: { fg: c.link },
  Preview_Frame: { hidden: true },
  // A terminal draws no frame, so it has no view to choose between.
  Preview_Choice: { hidden: true },
})
/** A complete example. */
export let specimens = (): Specimen[] => [
  [
    'Preview, variants',
    h(
      Preview,
      { mod: 'pane' },
      h(Preview.Frame, {
        mod: 'flat',
        title: 'Embedded page',
        srcdoc: '<p>A page.</p>',
        style: 'height:8rem',
      }),
    ),
  ],
  ['Preview, two choices', choices()],
  [
    'Preview',
    h(
      Preview,
      {},
      h(Preview.Address, { href: '#' }, 'example.com'),
      h(Preview.Frame, {
        title: 'Preview',
        srcdoc: '<p>A page preview.</p>',
        style: 'height:8rem',
      }),
    ),
  ],
]

let choices = () =>
  h(
    Preview.Choices,
    { role: 'radiogroup', 'aria-label': 'Preview views' },
    ['First', 'Second'].map((title, i) =>
      h(
        Preview.Item,
        {},
        h(
          Preview.Choice,
          {},
          h(Check.Input, {
            type: 'radio',
            name: 'preview-specimen',
            value: title,
            checked: i == 0,
          }),
          title,
        ),
        h(
          Preview.View,
          {},
          h(
            Preview.Address,
            { href: '#' },
            'example.com/' + title.toLowerCase(),
          ),
          h(Preview.Frame, {
            title,
            srcdoc: '<p>' + title + ' view</p>',
            style: 'height:8rem',
          }),
        ),
      )
    ),
  )
