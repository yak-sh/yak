/** A compact heading and its adjacent controls. @module */
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Button } from './Button.ts'

/** A compact heading and its adjacent controls. */
export let Toolbar: Part & Record<'Text' | 'Title' | 'Sub' | 'Label', Part> =
  block('header', 'Toolbar', {
    Text: 'div',
    Title: 'h1',
    Sub: 'p',
    Label: 'span',
  })
/** What this part presents. */
export let description = 'A compact heading and its adjacent controls.'
/** The same parts in a terminal. */
export let sheet = (c: Colors): Sheet => ({
  Toolbar: { row: true, spaced: true },
  Toolbar_Text: { col: true },
  Toolbar_Title: { bold: true },
  Toolbar_Sub: { fg: c.muted },
})
/** A complete example. */
export let specimens = (): Specimen[] => [
  [
    'Toolbar, variants',
    h(
      'div',
      {},
      h(
        Toolbar,
        { mod: 'compact' },
        h(Toolbar.Text, {}, h(Toolbar.Title, { as: 'h2' }, 'Preview')),
        h(Button, {}, h(Toolbar.Label, {}, 'Open')),
      ),
      h(Toolbar, { mod: 'narrow' }, 'Page'),
    ),
  ],
  [
    'Toolbar',
    h(
      Toolbar,
      {},
      h(
        Toolbar.Text,
        {},
        h(Toolbar.Title, { as: 'h2' }, 'Conversation'),
        h(Toolbar.Sub, {}, 'Your workspace'),
      ),
      h(Button, {}, 'Open'),
    ),
  ],
]
