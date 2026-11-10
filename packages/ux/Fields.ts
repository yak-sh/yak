/** Controlled fields and repeat groups, composed from the UI kit's controls.
 * The caller supplies visible fields, values and validation feedback. @module */
import { type ComponentChildren, h, type JSX } from 'preact'
import { Button, Card, Check, Field, Form, Notice } from '@yaks/ui'
import { named, type Path, valueAt, type Values } from './field-values.ts'

/** One visible input, or a repeat group containing visible inputs per entry. */
export type FieldSpec = {
  path: Path
  label: string
  kind: 'text' | 'lines' | 'choice' | 'check' | 'file' | 'repeat'
  required?: boolean
  hint?: string
  options?: readonly string[]
  multiple?: boolean
  type?: string
  autocomplete?: string
  inputMode?: string
  entries?: FieldSpec[][]
  blank?: Values
}

/** Values and feedback are supplied by the caller; edits name their path. */
export type FieldsProps = {
  at: string
  fields: FieldSpec[]
  values: Values
  disabled?: boolean
  owed?: ReadonlySet<string>
  onChange: (path: Path, value: unknown) => void
  onFile?: (path: Path, chosen: File) => void
}

let idOf = (at: string, path: Path) =>
  `field-${at}-${named(path)}`.replace(/[^\w.-]/g, '-')
let LISTED = 6

/** Renders typed controls, choice lists and repeat groups. */
export let Fields = (
  { at, fields, values, disabled, owed = new Set(), onChange, onFile }:
    FieldsProps,
): JSX.Element => {
  let set = (path: Path, value: unknown) => !disabled && onChange(path, value)
  let file = (path: Path, chosen: File) => onFile?.(path, chosen)
  let label = (a: FieldSpec, as?: string) => {
    let q = a
    return h(
      Form.Label,
      as ? { as, id: `${idOf(at, a.path)}-label` } : { for: idOf(at, a.path) },
      q.label,
      q.required || q.kind == 'check'
        ? null
        : [' ', h(Form.Optional, {}, '(optional)')],
    )
  }
  let after = (a: FieldSpec): ComponentChildren => [
    a.hint ? h(Form.Hint, {}, a.hint) : null,
    owed.has(named(a.path))
      ? h(Notice, { mod: 'negative' }, 'This one needs an answer.')
      : null,
  ]

  let draw = (a: FieldSpec): JSX.Element => {
    let q = a, path = a.path, name = named(path)
    let id = idOf(at, path), value = valueAt(values, path)
    let text = typeof value == 'string' ? value : ''
    switch (q.kind) {
      case 'repeat': {
        let entries = a.entries ?? []
        let least = q.required ? 1 : 0
        return h(
          Form.Field,
          { key: name, role: 'group', 'aria-labelledby': `${id}-label` },
          label(a, 'span'),
          entries.map((asked, i) =>
            h(
              Card,
              {
                key: `${name}.${i}`,
                role: 'group',
                'aria-label': `${q.label} ${i + 1}`,
              },
              h(
                Card.Head,
                {},
                h(Card.Title, { as: 'h3' }, `${q.label} ${i + 1}`),
                entries.length > least
                  ? h(
                    Card.Actions,
                    {},
                    h(Button, {
                      type: 'button',
                      disabled,
                      mod: 'quiet',
                      onClick: () =>
                        set(
                          path,
                          (valueAt(values, path) as Values[]).filter((
                            _,
                            j,
                          ) => j != i),
                        ),
                    }, 'Remove'),
                  )
                  : null,
              ),
              asked.map(draw),
            )
          ),
          h(
            Form.Actions,
            {},
            h(Button, {
              type: 'button',
              disabled,
              onClick: () =>
                set(path, [
                  ...(Array.isArray(value) ? value : []),
                  a.blank ?? {},
                ]),
            }, entries.length ? 'Add another' : 'Add'),
          ),
          after(a),
        )
      }
      case 'choice': {
        let many = q.multiple
        let choices = q.options ?? []
        let picked = many ? (Array.isArray(value) ? value as string[] : []) : []
        if (!many && choices.length > LISTED) {
          return h(
            Form.Field,
            { key: name },
            label(a),
            h(
              Field,
              {
                id,
                name,
                choose: true,
                required: q.required,
                disabled,
                value: text,
                onChange: (ev: Event) =>
                  set(
                    path,
                    (ev.target as HTMLSelectElement).value || undefined,
                  ),
              },
              h('option', { value: '' }, ''),
              choices.map((c) => h('option', { key: c, value: c }, c)),
            ),
            after(a),
          )
        }
        return h(
          Form.Field,
          { key: name, role: 'group', 'aria-labelledby': `${id}-label` },
          label(a, 'span'),
          choices.map((c) =>
            h(
              Check,
              { key: c },
              h(Check.Input, {
                type: many ? 'checkbox' : 'radio',
                name,
                value: c,
                required: !many && q.required,
                disabled,
                checked: many ? picked.includes(c) : value === c,
                onChange: () =>
                  set(
                    path,
                    !many
                      ? c
                      : picked.includes(c)
                      ? picked.filter((p) => p != c)
                      : choices.filter((x) => x == c || picked.includes(x)),
                  ),
              }),
              c,
            )
          ),
          after(a),
        )
      }
      case 'check':
        return h(
          Form.Field,
          { key: name },
          h(
            Check,
            {},
            h(Check.Input, {
              id,
              type: 'checkbox',
              name,
              value: 'true',
              required: q.required,
              disabled,
              checked: value === true,
              // Unchecked is no answer, so a required box must be checked.
              onChange: () => set(path, value === true ? undefined : true),
            }),
            q.label,
          ),
          after(a),
        )
      case 'file':
        return h(
          Form.Field,
          { key: name },
          label(a),
          h(Field, {
            id,
            name,
            type: 'file',
            required: q.required && !text,
            disabled,
            onChange: (ev: Event) => {
              let chosen = (ev.target as HTMLInputElement).files?.[0]
              if (chosen) {
                ;(ev.target as HTMLInputElement).value = ''
                void file(path, chosen)
              }
            },
          }),
          text ? h(Form.Value, {}, 'File uploaded.') : null,
          after(a),
        )
      default: {
        let lines = q.kind == 'lines'
        return h(
          Form.Field,
          { key: name },
          label(a),
          h(Field, {
            id,
            name,
            lines,
            required: q.required,
            disabled,
            value: text,
            type: q.type,
            autocomplete: q.autocomplete,
            inputMode: q.inputMode,
            onInput: (ev: Event) =>
              set(
                path,
                (ev.target as HTMLInputElement).value === ''
                  ? undefined
                  : (ev.target as HTMLInputElement).value,
              ),
          }),
          after(a),
        )
      }
    }
  }

  return h('div', { class: 'Fields' }, fields.map(draw))
}
