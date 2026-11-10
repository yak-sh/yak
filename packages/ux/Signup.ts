/** A sign-up form drawn from its question rows (@yaks/forms) with @yaks/ui's
 * form parts. It reads the form from its door (`GET ./api/form/<form>`, in
 * this app or another) and sends the answers there. The consumer keeps the
 * emitted Signup{…} bundles on `signupAt(at)` and supplies them again, so a
 * remount finds its status. Answers live in the host's durable drafts.
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { useHost } from './host.ts'
import type { Bundle } from '@yaks/graph'
import { type Upload, upload } from './Signup-file.ts'
export { signupBlob, type Upload, upload } from './Signup-file.ts'
import { derivedEid } from '@yaks/graph/identity'
import {
  type Answers,
  type Asked,
  asked,
  type Form as Rows,
  kept,
  missing,
  type Question,
  type Settings,
} from '@yaks/forms'
import {
  Body,
  Button,
  Card,
  Check,
  Field,
  Form,
  Loading,
  Notice,
} from '@yaks/ui'

/** What a form's door answers to GET: the form's own rows, and whether it
 * takes sign-ups now. */
export type Door = {
  entity?: { eid: string }
  doc?: { title?: string; body?: string }
  form: Settings
  open: boolean
  questions: Question[]
}

/** What a sign-up holds while a person fills it in. */
export type SignupState = {
  /** the form as its door answered */
  door?: Door
  /** why the form could not be read */
  unread?: string
  /** the current draft's answers, mirrored for the consumer */
  answers?: Answers
  /** a send was tried, so required questions still owed say so */
  tried?: boolean
  /** a send is on its way */
  sending?: boolean
  /** the door took it; the form's thanks show */
  sent?: boolean
  /** why the door refused it, in its words */
  said?: string
}

/** Sends answers; resolves to the refusal's words, or undefined once taken. */
export type Send = (at: string, answers: Answers) => Promise<string | undefined>

/** Reads a form from its door; resolves to the words saying why it could
 * not. */
export type Read = (at: string) => Promise<Door | string>

/** The page entity carrying the sign-up state of the form at a door. */
export let signupAt = (at: string): string =>
  derivedEid(['Signup', at].join('|'))

/** The state a bundle carries; missing state is a fresh form. */
export let signupOf = (e?: Bundle): SignupState =>
  (e?.Signup as SignupState | undefined) ?? {}

/** Feedback on the page after a native form post, scoped to this door. */
export let signupReturned = (
  at: string,
  page: string,
  base = page,
): Pick<SignupState, 'sent' | 'said'> | undefined => {
  try {
    let url = new URL(page), door = new URL(at, base)
    let result = JSON.parse(url.searchParams.get('yak-form') ?? 'null')
    door.search = ''
    door.hash = ''
    if (result?.at != door.href) return
    if (result.sent === true) return { sent: true }
    if (typeof result.said == 'string') return { said: result.said }
  } catch { /* An unrelated page parameter carries no form feedback. */ }
}

/** The answer at `path`, set to `value`; undefined removes it. */
let put = (
  answers: Answers,
  [key, ...rest]: readonly (string | number)[],
  value: unknown,
): Answers => {
  let next: Record<string, unknown> = { ...answers }
  if (rest.length == 0) {
    if (value === undefined) delete next[key]
    else next[key] = value
    return next
  }
  let list = Array.isArray(answers[key]) ? [...answers[key] as Answers[]] : []
  let [at, ...deeper] = rest as [number, ...(string | number)[]]
  list[at] = deeper.length
    ? put(list[at] ?? {}, deeper, value)
    : value as Answers
  next[key] = list
  return next
}

/** The answer at `path`. */
let answerAt = (
  answers: Answers,
  path: readonly (string | number)[],
): unknown =>
  path.reduce<unknown>(
    (at, key) => (at as Record<string | number, unknown> | undefined)?.[key],
    answers,
  )

/** A new repeat entry: each required repeat inside it starts with one entry. */
let entry = (questions: readonly Question[], within: string): Answers =>
  Object.fromEntries(
    questions.filter((q) =>
      q.question.within == within && q.question.kind == 'repeat' &&
      q.question.required
    ).map((q) => [q.entity.eid, [entry(questions, q.entity.eid)]]),
  )

/** What a form starts with: one entry in each required repeat. */
let fresh = (questions: readonly Question[]): Answers =>
  entry(questions, undefined as unknown as string)

/** The default read: the form door's JSON. */
export let get: Read = async (at) => {
  try {
    let r = await fetch(at, { headers: { accept: 'application/json' } })
    if (r.status == 404) return 'There is no such form.'
    if (!r.ok) return 'This form could not be loaded. Try again.'
    return await r.json() as Door
  } catch {
    return 'This form could not be loaded. Check the connection and try again.'
  }
}

/** The default send: the answers as JSON to the form door. */
export let post: Send = async (at, answers) => {
  try {
    let r = await fetch(at, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers }),
    })
    if (r.ok) return undefined
    return (await r.text()).trim() || 'That did not send. Try again.'
  } catch {
    return 'That did not send. Check the connection and try again.'
  }
}

/** The form's door, with the state its consumer keeps. */
export type SignupProps = {
  /** the form's door: `./api/form/<alias>`, or another app's,
   * `/directory/api/form/kids-club` */
  at: string
  /** the Signup state on `signupAt(at)`; absent is a form not yet read */
  e?: Bundle
  onChange: (b: Bundle) => void
  /** how it reads the form; GET from `at` by default */
  read?: Read
  /** how it sends; JSON to `at` by default */
  send?: Send
  /** how a selected file is uploaded; the form app's blob door by default */
  upload?: Upload
}

let named = (path: readonly (string | number)[]) => path.join('.')
let idOf = (form: string, path: readonly (string | number)[]) =>
  `signup-${form}-${named(path)}`.replace(/[^\w.-]/g, '-')

let paragraphs = (text?: string) =>
  text?.trim()
    ? h(
      Body,
      {},
      text.trim().split(/\n\s*\n/).map((p) => h('p', {}, p.trim())),
    )
    : null

let input: Partial<
  Record<Question['question']['kind'], Record<string, string>>
> = {
  email: { type: 'email', autocomplete: 'email', inputMode: 'email' },
  phone: { type: 'tel', autocomplete: 'tel', inputMode: 'tel' },
  date: { type: 'date' },
  address: { autocomplete: 'street-address' },
}

/** Many choices are picked from a list; a few are each a row to press. */
let LISTED = 6

/** Draws any form from its questions, and sends it to the form door. */
export let Signup = (
  { at, e, onChange, read = get, send = post, upload: sendFile = upload }:
    SignupProps,
): JSX.Element => {
  let { drafts } = useHost()
  let base = globalThis.document?.baseURI || globalThis.location?.href
  let place = `signup:${signupAt(base ? new URL(at, base).href : at)}`
  let text = drafts.text(place)
  let answers: Answers | undefined = text ? JSON.parse(text) : undefined
  let state = signupOf(e)
  let latest = useRef(state)
  // A draft signal can repaint before the consumer returns emitted state.
  let prior = useRef(e)
  if (e !== prior.current) latest.current = state
  prior.current = e
  let emit = (change: SignupState) => {
    latest.current = { ...latest.current, ...change }
    onChange({ entity: { eid: signupAt(at) }, Signup: latest.current })
  }
  let load = async () => {
    emit({ unread: undefined })
    let door = await read(at)
    emit(typeof door == 'string' ? { unread: door } : { door })
  }
  let door = state.door
  useEffect(() => {
    if (JSON.stringify(state.answers) != JSON.stringify(answers)) {
      emit({ answers })
    }
  }, [text])
  useEffect(() => {
    let page = globalThis.location?.href
    let result = page &&
      signupReturned(at, page, globalThis.document?.baseURI || page)
    if (result) {
      if (result.sent) drafts.spend(place)
      emit(result)
      let url = new URL(page)
      url.searchParams.delete('yak-form')
      globalThis.history?.replaceState(globalThis.history.state, '', url.href)
    }
    if (!door && !state.unread) void load()
  }, [at])
  if (!door) {
    return h(
      'section',
      { class: 'Signup' },
      state.unread
        ? [
          h(Notice, { mod: 'negative', role: 'alert' }, state.unread),
          h(
            Form.Actions,
            {},
            h(Button, { type: 'button', onClick: load }, 'Try again'),
          ),
        ]
        : h(Loading, {}, 'Loading the form…'),
    )
  }
  let change = (next: SignupState) => {
    if (next.answers) drafts.type(place, JSON.stringify(next.answers))
    emit(next)
  }
  let file = async (path: (string | number)[], chosen: File) => {
    if (latest.current.sending) return
    change({
      sending: true,
      said: undefined,
      answers: put(
        latest.current.answers ?? fresh(door.questions),
        path,
        undefined,
      ),
    })
    let result = await sendFile(at, String(path.at(-1)), chosen)
    change(
      typeof result == 'string' ? { sending: false, said: result } : {
        sending: false,
        answers: put(
          latest.current.answers ?? fresh(door.questions),
          path,
          result.eid,
        ),
      },
    )
  }
  let sent: Send = async (at, answers) => {
    let before = drafts.text(place)
    let said = await send(at, answers)
    if (said == null && drafts.text(place) == before) drafts.spend(place)
    return said
  }
  return drawn(at, door, { ...state, answers }, change, sent, file)
}

let drawn = (
  at: string,
  { doc = {}, form: settings, open, questions }: Door,
  state: SignupState,
  emit: (change: SignupState) => void,
  send: Send,
  file: (path: (string | number)[], chosen: File) => Promise<void>,
): JSX.Element => {
  let rows: Rows = { form: settings, questions }
  let answers = state.answers ?? fresh(questions)
  let eid = at
  let title = doc.title ? h('h2', {}, doc.title) : null

  if (state.sent) {
    return h(
      'section',
      { class: 'Signup', role: 'status' },
      title,
      paragraphs(settings.thanks ?? 'Thank you. Your answers are in.'),
      h(
        Form.Actions,
        {},
        h(Button, {
          type: 'button',
          onClick: () => emit({ sent: false, tried: false }),
        }, 'Fill it in again'),
      ),
    )
  }
  if (!open) {
    return h(
      'section',
      { class: 'Signup' },
      title,
      paragraphs(settings.closed ?? 'This form is closed.'),
      state.said
        ? h(Notice, { mod: 'negative', role: 'alert' }, state.said)
        : null,
    )
  }

  let owed = new Set(
    state.tried
      ? missing(rows, kept(rows, answers)).map((o) => named(o.path))
      : [],
  )
  let set = (path: (string | number)[], value: unknown) =>
    !state.sending &&
    emit({ answers: put(answers, path, value), said: undefined })

  let label = (a: Asked, as?: string) => {
    let q = a.question.question
    return h(
      Form.Label,
      as
        ? { as, id: `${idOf(eid, a.path)}-label` }
        : { for: idOf(eid, a.path) },
      q.label,
      q.required || q.kind == 'check'
        ? null
        : [' ', h(Form.Optional, {}, '(optional)')],
    )
  }
  let after = (a: Asked): ComponentChildren => [
    a.question.question.hint
      ? h(Form.Hint, {}, a.question.question.hint)
      : null,
    owed.has(named(a.path))
      ? h(Notice, { mod: 'negative' }, 'This one needs an answer.')
      : null,
  ]

  let draw = (a: Asked): JSX.Element => {
    let q = a.question.question, path = a.path, name = named(path)
    let id = idOf(eid, path), value = answerAt(answers, path)
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
                      disabled: state.sending,
                      mod: 'quiet',
                      onClick: () =>
                        set(
                          path,
                          (answerAt(answers, path) as Answers[]).filter((
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
              disabled: state.sending,
              onClick: () =>
                set(path, [
                  ...(Array.isArray(value) ? value : []),
                  entry(questions, a.question.entity.eid),
                ]),
            }, entries.length ? 'Add another' : 'Add'),
          ),
          after(a),
        )
      }
      case 'choose':
      case 'choices': {
        let many = q.kind == 'choices'
        let choices = q.choices ?? []
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
                disabled: state.sending,
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
                disabled: state.sending,
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
              disabled: state.sending,
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
            disabled: state.sending,
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
        let lines = q.kind == 'lines' || q.kind == 'address'
        return h(
          Form.Field,
          { key: name },
          label(a),
          h(Field, {
            id,
            name,
            lines,
            required: q.required,
            disabled: state.sending,
            value: text,
            ...(input[q.kind] ?? {}),
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

  let submit = async (ev: Event) => {
    ev.preventDefault()
    if (state.sending) return
    let sending = kept(rows, answers)
    if (missing(rows, sending).length) return emit({ tried: true })
    emit({ answers, tried: true, sending: true, said: undefined })
    let said = await send(at, sending)
    emit(
      said == null ? { sending: false, sent: true } : { sending: false, said },
    )
  }

  return h(
    'section',
    { class: 'Signup' },
    title,
    paragraphs(doc.body),
    h(
      Form,
      { method: 'post', action: at, onSubmit: submit },
      asked(rows, answers).map(draw),
      h(
        Form.Actions,
        {},
        h(Button, {
          type: 'submit',
          mod: 'go',
          disabled: state.sending,
        }, state.sending ? 'Sending…' : 'Send'),
      ),
      state.said
        ? h(Notice, { mod: 'negative', role: 'alert' }, state.said)
        : null,
      owed.size && !state.said
        ? h(Notice, { mod: 'negative' }, 'Some answers are still needed.')
        : null,
    ),
  )
}
