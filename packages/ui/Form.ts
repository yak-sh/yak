/**
 * A form: each `Form.Field` its `Label` over its control over its `Hint`, on
 * one left edge and one width, and what sends it at the end, in
 * `Form.Actions`. A field never trails a sentence: what explains it is its
 * hint, under it. A label says a field may be left empty in a
 * `Form.Optional` beside its words. `Form.Line` keeps one field and the
 * button that sends it on one line while they fit. A value nobody may change
 * here (JSON Schema's `readOnly`) is `Form.Value`, its words where a control
 * would be, under a label that is no `label` for: `Form.Value-none` says
 * there is none. What sending does is the caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Button } from './Button.ts'
import { Field } from './Field.ts'

/** A form. */
export let Form:
  & Part
  & Record<
    'Field' | 'Label' | 'Optional' | 'Hint' | 'Value' | 'Line' | 'Actions',
    Part
  > = block('form', 'Form', {
    Field: 'div',
    Label: 'label',
    Optional: 'span',
    Hint: 'p',
    Value: 'p',
    Line: 'div',
    Actions: 'div',
  })

/** What it is, in a line. */
export let description =
  'A form: each field its label over it and its hint under it, then its send.'

/** Each field is lines of its own, a blank line after it; what describes it
 * is muted. */
export let sheet = (c: Colors): Sheet => ({
  Form_Field: { block: true, gap: true },
  Form_Label: { fg: c.text, bold: true, block: true },
  Form_Optional: { fg: c.muted },
  Form_Hint: { fg: c.muted },
  Form_Value: { fg: c.text, wrap: true },
  'Form_Value-none': { fg: c.dim },
  Form_Line: { spaced: true },
  Form_Actions: { spaced: true },
})

let { Label, Optional, Hint, Value, Line, Actions } = Form

/** A form of two fields, one optional and one on a line with its button, and
 * a value the form shows but does not change. */
export let specimens = (): Specimen[] => [
  [
    'Form, Field, Label, Optional, Hint, Line, Actions',
    h(
      Form,
      { onSubmit: (e: Event) => e.preventDefault() },
      h(
        Form.Field,
        {},
        h(Label, { for: 'form-service' }, 'Service'),
        h(Field, { id: 'form-service', value: '', placeholder: 'Weather API' }),
        h(Hint, {}, 'The name the key is kept under.'),
      ),
      h(
        Form.Field,
        {},
        h(
          Label,
          { for: 'form-note' },
          'How to get the key ',
          h(Optional, {}, '(optional)'),
        ),
        h(Field, { id: 'form-note', lines: true, value: '' }),
      ),
      h(
        Form.Field,
        {},
        h(Label, { as: 'span' }, 'Slug'),
        h(Value, {}, 'weather-api'),
        h(Hint, {}, 'Made from the service, so it is not typed here.'),
      ),
      h(
        Form.Field,
        {},
        h(Label, { as: 'span' }, 'Last used'),
        h(Value, { mod: 'none' }, 'None'),
      ),
      h(
        Form.Field,
        {},
        h(Label, { for: 'form-tag' }, 'Tag'),
        h(
          Line,
          {},
          h(Field, { id: 'form-tag', value: 'weather' }),
          h(Button, { type: 'button' }, 'add'),
        ),
      ),
      h(Actions, {}, h(Button, { type: 'submit', mod: 'go' }, 'Save key')),
    ),
  ],
]
