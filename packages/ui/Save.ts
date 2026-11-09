/** The viewport's pending changes and the fields they came from. */
import { h } from 'preact'
import type { Sheet } from '@yaks/tui/theme'
import { block, type Part } from './el.ts'
import { Button } from './Button.ts'
import { Field } from './Field.ts'
import { Form } from './Form.ts'
import type { Colors, Specimen } from './theme.ts'

/** One fixed bar, with a changed field's mark beside its label. */
export let Save:
  & Part
  & Record<'Count' | 'Actions' | 'Field' | 'Mark' | 'Notice', Part> = block(
    'aside',
    'Save',
    {
      Count: 'span',
      Actions: 'div',
      Field: 'div',
      Mark: 'span',
      Notice: 'p',
    },
  )

export let description = 'Pending changes, saved or discarded together.'

export let sheet = (c: Colors): Sheet => ({
  Save: { block: true, spaced: true, bg: c.surface },
  Save_Count: { fg: c.text },
  Save_Actions: { spaced: true },
  Save_Mark: { fg: c.accent },
  Save_Notice: { fg: c.negative },
})

export let specimens = (): Specimen[] => [[
  'Two changes, ready to save',
  h(
    Save,
    { mod: 'sample' },
    h(Save.Count, {}, '2 changes'),
    h(
      Save.Actions,
      {},
      h(Button, { type: 'button', mod: 'quiet' }, 'Discard'),
      h(Button, { type: 'button', mod: 'go' }, 'Save'),
    ),
  ),
], [
  'A changed field',
  h(
    Save.Field,
    { as: Form.Field, mod: 'changed' },
    h(Form.Label, { for: 'save-name' }, 'Name'),
    h(Field, { id: 'save-name', value: 'A changed name' }),
  ),
], [
  'A failed save keeps its changes',
  h(
    Save,
    { mod: 'sample' },
    h(Save.Count, {}, '1 change'),
    h(Save.Notice, {}, 'Your changes could not be saved. Try again.'),
  ),
]]
