// The `@yaks/persona/ui` facet: what a persona's people change of it, drawn
// from the kit's parts. Where a card's fields are sent is its host's: the
// host puts it in its form.
import { h, type JSX } from 'preact'
import { Card, Field, Form } from '@yaks/ui/parts'
import { LONGEST } from './name.ts'

/** Where a persona's people change what it is called (`doc{title}`): one
 * field, `name`, holding `name` now, as long as `given` (./name.ts) takes. */
export let NameCard = ({ name }: { name: string }): JSX.Element =>
  h(
    Card,
    null,
    h(Card.Head, null, h(Card.Title, null, 'Name')),
    h(
      'p',
      null,
      'What it goes by. It introduces itself by this name and signs what it writes with it.',
    ),
    h(
      Form.Field,
      null,
      h(Form.Label, { for: 'persona-name' }, 'Name'),
      h(Field, {
        id: 'persona-name',
        name: 'name',
        value: name,
        maxlength: LONGEST,
        required: true,
        autocomplete: 'off',
      }),
    ),
  )
