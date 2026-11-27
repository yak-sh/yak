/**
 * The box a key is pasted in, wherever a person is asked for one: a task
 * asking for a connection (`asks`), a connections page, a sign-in page. It is
 * plain markup for a server's page and a component for a live one, shared by
 * every host; what saving does is the host's (`save`), and a page writes
 * {@link pasted} through the graph, which seals the value out of the write.
 * The key is never prefilled, drawn back, or kept in the page's state.
 *
 * @module
 */
import { type ComponentChildren as Kids, h, type JSX } from 'preact'
import { useState } from 'preact/hooks'
import { Button, Field as Box, Form, Section } from '@yaks/ui'
import { type Field, fieldsOf, KEY } from './field.ts'
import type { Pasted } from './paste.ts'

export { type Pasted, pasted } from './paste.ts'
export { type Field, fieldsOf, KEY }

let labeled = (id: string, label: Kids, control: Kids, hint: Kids = '') =>
  h(
    Form.Field,
    null,
    h(Form.Label, { for: id }, label),
    control,
    hint ? h(Form.Hint, null, hint) : null,
  )

/** The box a key is pasted in and the button that saves it, one line under
 * its label; or, for a service that asks for several fields, a box for each
 * under its own label, masked unless the field is shown, and the button under
 * them. Each box shows what its field looks like, where the integration says,
 * and a row of dots where it does not. {@link givenOf} reads what was typed. */
export let keyBox = (
  id: string,
  label: Kids,
  send: Kids,
  hint: Kids = '',
  fields: Field[] = [KEY],
): Kids => {
  let box = (at: string, name: string, f: Field) =>
    h(Box, {
      id: at,
      name,
      type: f.shown ? 'text' : 'password',
      placeholder: f.example || '••••••••',
      autocomplete: 'off',
      spellcheck: 'false',
      required: true,
    })
  if (fields.length == 1) {
    return labeled(
      id,
      fields[0].label == KEY.label ? label : fields[0].label,
      h(Form.Line, null, box(id, 'key', fields[0]), send),
      hint,
    )
  }
  return [
    ...fields.map((f) =>
      labeled(
        `${id}-${f.name}`,
        f.label,
        box(`${id}-${f.name}`, `key.${f.name}`, f),
      )
    ),
    send ? h(Form.Actions, null, send) : null,
    hint ? h(Form.Hint, null, hint) : null,
  ]
}

/** What a person typed into a {@link keyBox}, read from its form by name
 * (a posted `FormData`, or the boxes themselves): the one key, or each field
 * by name; or what the page says when one was left empty.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let form = new FormData()
 * form.set('key', ' k ')
 * assertEquals(givenOf(form, [{ name: 'key', label: 'Key' }]), { key: 'k' })
 * assertEquals(givenOf(new FormData(), [{ name: 'key', label: 'Key' }]), 'Paste the key first.')
 * ```
 */
export let givenOf = (
  form: { get: (name: string) => unknown },
  fields: Field[],
): Pasted | string => {
  let at = (k: string) => String(form.get(k) ?? '').trim()
  if (fields.length == 1) {
    return at('key') ? { key: at('key') } : 'Paste the key first.'
  }
  let said = Object.fromEntries(
    fields.map((f) => [f.name, at(`key.${f.name}`)]),
  )
  let missing = fields.find((f) => !said[f.name])
  return missing ? `Fill in ${missing.label} first.` : { fields: said }
}

/** A connection a person is asked to paste a key for, as a live page draws
 * it: what it is for, how to get the key (`howTo`, drawn by the host), the
 * box, anything the host adds under it (`children`), and what came of
 * saving. A connection whose last key the service refused (`broken`) asks
 * again; once connected, only what came of saving stays, and no box. `save`
 * keeps what was given and resolves once the write is answered; what the page
 * says after is its own. */
export let KeyForm = (
  { id, title, fields, status, howTo, save, children }: {
    id: string
    title: Kids
    fields: Field[]
    status: string
    howTo?: Kids
    save: (given: Pasted) => Promise<unknown>
    /** more the host draws inside the form, under the box */
    children?: Kids
  },
): JSX.Element | null => {
  let [said, say] = useState('')
  let [busy, setBusy] = useState(false)
  let connected = status == 'connected'
  if (connected && !said) return null
  let submit = async (ev: Event) => {
    ev.preventDefault()
    let form = ev.currentTarget as HTMLFormElement
    let given = givenOf({
      get: (name) =>
        form.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value,
    }, fields)
    if (typeof given == 'string') return say(given)
    setBusy(true)
    say('')
    try {
      await save(given)
      form.reset()
      say('Saved. It is checked, then kept where it is used.')
    } catch (e) {
      say(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return h(
    Section,
    { 'data-key': id },
    h(
      Section.Title,
      {},
      title,
      h(
        Section.Note,
        {},
        connected ? 'connected' : status == 'broken' ? 'refused' : 'needed',
      ),
    ),
    status == 'broken'
      ? h(Section.Sub, {}, 'The service refused the last key. Paste a new one.')
      : null,
    connected ? null : howTo,
    connected ? null : h(
      Form,
      { onSubmit: submit },
      keyBox(
        `key-${id}`,
        'Paste the key',
        h(Button, { type: 'submit', mod: 'go', disabled: busy }, 'Save key'),
        '',
        fields,
      ),
      children,
    ),
    said ? h(Section.Note, { role: 'status' }, said) : null,
  )
}
