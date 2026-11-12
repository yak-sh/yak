import { Form } from './Form.ts'
/** A message field, attachments and controls for sending it. @module */
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Button } from './Button.ts'
import { Drop } from './Drop.ts'
import { Field } from './Field.ts'
import { Notice } from './Notice.ts'

let Gather: Part = (p) => h(Drop, { ...p, mod: 'gather' })
let Send: Part = (p) => h(Button, { ...p, mod: 'go' })

/** A message field, attachments and controls for sending it. */
export let Composer:
  & Part
  & Record<
    | 'Form'
    | 'Figure'
    | 'Field'
    | 'Tools'
    | 'Attach'
    | 'File'
    | 'Stop'
    | 'Send'
    | 'Voice'
    | 'Status'
    | 'To',
    Part
  > = block(Gather, 'Composer', {
    Form,
    Figure: 'img',
    Field: Field as Part,
    Tools: 'div',
    Attach: 'label',
    File: Drop.File,
    Stop: Button,
    Send: Send,
    Voice: Button,
    Status: Notice,
    To: 'p',
  })
/** What this part presents. */
export let description =
  'A message field, attachments and controls for sending it.'
/** The same parts in a terminal. */
export let sheet = (c: Colors): Sheet => ({
  Composer: { col: true, gap: true },
  Composer_Tools: { row: true, spaced: true },
  Composer_Figure: { hidden: true },
  Composer_Status: { fg: c.muted },
  Composer_To: { fg: c.muted },
})
/** A complete example. */
export let specimens = (): Specimen[] => [
  [
    'Composer, variants',
    h(
      Composer.Form,
      { mod: 'inline' },
      h(
        Composer,
        { 'data-busy': '' },
        h(Composer.To, {}, 'To your conversation, not this one'),
        h(Composer.Figure, {
          alt: '',
          src:
            'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E',
        }),
        h(Composer.Field, { lines: true, placeholder: 'Write a message' }),
        h(
          Composer.Tools,
          {},
          h(Composer.Stop, { type: 'button' }, 'Stop'),
          h(Composer.Voice, { type: 'button' }, 'Speak'),
          h(Composer.Send, { type: 'button' }, 'Send'),
        ),
      ),
      h(Composer.Status, {}, 'Your draft is kept.'),
    ),
  ],
  [
    'Composer',
    h(
      Composer,
      {},
      h(Composer.Field, { lines: true, placeholder: 'Write a message' }),
      h(
        Composer.Tools,
        {},
        h(Composer.Attach, {}, 'Add files', h(Composer.File, { type: 'file' })),
        h(Composer.Send, { type: 'button' }, 'Send'),
      ),
    ),
  ],
]
