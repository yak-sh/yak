/** Shared painting primitives. Compose a part from one of these to inherit
 * its skin's surface, edge and interaction without knowing that skin. */
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import type { Sheet } from '@yaks/tui/theme'

/** A flat surface, an elevated surface, a press and an input well. */
export let Surface: Part & Record<'Raised' | 'Press' | 'Well', Part> = Object
  .assign(el('section', 'Surface'), {
    Raised: el('div', 'Surface_Raised'),
    Press: el('button', 'Surface_Press'),
    Well: el('input', 'Surface_Well'),
  })

export let description = 'Shared surfaces: flat, raised, pressed and inset.'
export let sheet = (c: Colors): Sheet => ({
  Surface: { bg: c.card },
  Surface_Raised: { bg: c.card },
  Surface_Press: { fg: c.text, bg: c.card },
  Surface_Well: { fg: c.text, bg: c.surface },
})

/** The primitives beside one another, without a component-specific skin. */
export let specimens = (): Specimen[] => [
  ['Surface', h(Surface, {}, 'Flat surface')],
  ['Surface.Raised', h(Surface.Raised, {}, 'Raised surface')],
  ['Surface.Press', h(Surface.Press, { type: 'button' }, 'Press')],
  ['Surface.Well', h(Surface.Well, { value: 'Input well' })],
]
