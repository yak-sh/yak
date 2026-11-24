/**
 * The visitors' book: a form that keeps what a visitor types until the book has
 * it, and the notes left so far. The look is @yaks/ui's parts in this app's
 * own colours (style.css); the form's behaviour is @yaks/ux's `Submit` and
 * `Fields` over the store's drafts, so a half-written note survives a reload,
 * another tab and another device, and a failed save keeps it and says why.
 *
 * @module
 */
import { h, render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { Button, Card, Empty, Form, Notice, Rows, Stamp } from '@yaks/ui'
import { relative } from '@yaks/ui/relative'
import { kits, themes } from '@yaks/ui/ui'
import { wear } from '@yaks/ui/wear'
import {
  type Bundle,
  Fields,
  type FieldSpec,
  putValue,
  Submit,
  type Values,
} from '@yaks/ux'

type Note = {
  entity: { eid: string }
  note: { name: string; message: string }
  created?: { at: string }
}

// client.js is served beside the page, so its address is resolved at runtime.
let { apply, drafts, subscribe } = await import(
  new URL('api/client.js', document.baseURI).href
)
let [copy] = await Promise.all([
  fetch('copy.json').then((r) => r.json()),
  wear({ kits, theme: themes.linen }),
])
let desk = drafts()

/** A snippet of copy.json, marked so the page's pencil can edit it. */
let say = (key: string) => ({
  'data-copy': key,
  children: key.split('.').reduce((o, k) => o?.[k], copy) ?? '',
})

let fields: FieldSpec[] = [
  { path: ['name'], label: copy.form.name, kind: 'text', required: true },
  {
    path: ['message'],
    label: copy.form.message,
    kind: 'lines',
    required: true,
  },
]
let filled = (v: Values) =>
  fields.every((f) => String(v[f.path[0]] ?? '').trim())

/** The form: Submit keeps its values in the visitor's draft at `place`, and
 * spends that draft only once the note is stored. */
let Sign = () => {
  let [e, setE] = useState<Bundle>()
  return h(Submit<object>, {
    at: 'sign',
    place: 'signbook:sign',
    drafts: desk,
    e,
    onChange: setE,
    read: () => Promise.resolve({}),
    send: async (_at, v) => {
      try {
        await apply([{
          entity: { eid: '$note' },
          note: { name: String(v.name).trim(), message: String(v.message) },
        }])
      } catch (err) {
        return (err as Error).message
      }
    },
    render: ({ state, change, send }) => {
      let values = state.values ?? {}
      let sign = async (ev: Event) => {
        ev.preventDefault()
        if (state.sending) return
        if (!filled(values)) return change({ tried: true, sent: false })
        change({ sending: true, said: undefined, sent: false })
        let said = await send('sign', values)
        change(
          said == null
            ? { sending: false, sent: true, tried: false }
            : { sending: false, said },
        )
      }
      return h(
        Form,
        { onSubmit: sign, noValidate: true },
        h(Fields, {
          at: 'sign',
          fields,
          values,
          disabled: state.sending,
          onChange: (path, value) =>
            change({ values: putValue(values, path, value), sent: false }),
        }),
        state.tried && !filled(values)
          ? h(Notice, { mod: 'negative', ...say('form.owed') })
          : null,
        state.said
          ? h(Notice, { mod: 'negative', role: 'alert' }, state.said)
          : null,
        state.sent ? h(Notice, { role: 'status', ...say('form.sent') }) : null,
        h(
          Form.Actions,
          {},
          h(
            Button,
            { type: 'submit', mod: 'go', disabled: state.sending },
            h('span', say(state.sending ? 'form.sending' : 'form.send')),
          ),
        ),
      )
    },
  })
}

/** Every note, newest first. */
let Book = () => {
  let [notes, setNotes] = useState<Note[]>()
  useEffect(() => {
    return subscribe('.note&?created', (rows: Note[]) =>
      setNotes(
        [...rows].sort((a, b) =>
          (b.created?.at ?? '').localeCompare(a.created?.at ?? '')
        ),
      ))
  }, [])
  if (!notes) return null
  if (!notes.length) {
    return h(
      Empty,
      {},
      h(Empty.Title, say('empty.title')),
      h('p', say('empty.body')),
    )
  }
  return h(
    Rows,
    {},
    notes.map((n) =>
      h(
        Rows.Item,
        { key: n.entity.eid },
        h(
          Rows.Main,
          {},
          h(Rows.Name, {}, n.note.name),
          h(Rows.Meta, {}, n.note.message),
        ),
        n.created ? h(Stamp, {}, relative(n.created.at, Date.now())) : null,
      )
    ),
  )
}

render(
  h('div', {}, h(Card, {}, h(Sign, {})), h(Book, {})),
  document.getElementById('app')!,
)
