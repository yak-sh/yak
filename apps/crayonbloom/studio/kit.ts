/** What the studio's views share: a field under its label, a select's
 * options, a press that names its act, and where a book's files are. */
import { h } from 'preact'
import { Button, Field, type FieldProps, Form } from '@yaks/ui/parts'
import type { Place } from '../pages/chrome.ts'
import type { Book } from './rows.ts'

/** A field under its label. `optional` says it may be left empty. */
export let Labeled = (
  { id, title, optional, ...field }: FieldProps & {
    id: string
    title: string
    optional?: boolean
  },
) =>
  h(
    Form.Field,
    {},
    h(
      Form.Label,
      { for: id },
      title,
      optional && [' ', h(Form.Optional, {}, '(optional)')],
    ),
    h(Field, { id, ...field }),
  )

/** A select's options, each a value and what it is called, one chosen. */
export let options = (all: [string, string][], chosen?: string) =>
  all.map(([value, said]) =>
    h('option', { value, selected: value == chosen }, said)
  )

/** A press that names what it does in `data-act`, for the studio to hear. */
export let press = (
  act: string,
  said: string,
  more: Record<string, unknown> = {},
) => h(Button, { type: 'button', 'data-act': act, ...more }, said)

/** Where one of a book's stored files is served. */
export let filed = (place: Place, book: Book) => (blob: string) =>
  place.at(`/studio/file?id=${book.entity.eid}&blob=${blob}`)
