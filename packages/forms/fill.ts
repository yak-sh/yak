/** Adapts form questions and their HTTP door to controlled kit components. @module */
import { h, type JSX } from 'preact'
import { derivedEid } from '@yaks/graph/identity'
import { Body, Button, Form, Notice } from '@yaks/ui'
import {
  Fields,
  type FieldSpec,
  putValue as put,
  type SubmitProps,
  type SubmitState,
} from '@yaks/ux'
import { type Upload, upload } from './file.ts'
import {
  type Answers,
  type Asked,
  asked,
  type Form as Rows,
  kept,
  missing,
  type Question,
  type Settings,
  SIGNS,
  type Signs,
} from './mod.ts'
export { blobAt, type Upload, upload } from './file.ts'

let named = (path: readonly (string | number)[]) => path.join('.')

/** What a form's door answers to GET: the form's own rows, whether it
 * takes sign-ups now, and, for a caller the app knows, the answers its rows
 * already hold for them. */
export type Door = {
  entity?: { eid: string }
  doc?: { title?: string; body?: string }
  form: Settings
  open: boolean
  questions: Question[]
  answers?: Answers
}

export type Read = (at: string) => Promise<Door | string>
/** Sends a form's answers, and the signs of who sent them, which the door
 * screens bots by. */
export type Send = (
  at: string,
  answers: Answers,
  signs?: Signs,
) => Promise<string | undefined>
/** Feedback on the page after a native form post, scoped to this door. */
export let returned = (
  at: string,
  page: string,
  base = page,
): Pick<SubmitState, 'sent' | 'said'> | undefined => {
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

/** A new repeat entry: each required repeat inside it starts with one entry. */
let entry = (questions: readonly Question[], within: string): Answers =>
  Object.fromEntries(
    questions.filter((q) =>
      q.question.within == within && q.question.kind == 'repeat' &&
      q.question.required
    ).map((q) => [q.entity.eid, [entry(questions, q.entity.eid)]]),
  )

/** What a form starts with: one entry in each required repeat, and what the
 * door already knows of the person filling it in. */
let fresh = ({ questions, answers }: Door): Answers => ({
  ...entry(questions, undefined as unknown as string),
  ...answers,
})

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

/** The default send: the answers and their signs as JSON to the form door. */
export let post: Send = async (at, answers, signs) => {
  try {
    let r = await fetch(at, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers, ...signs ? { signs } : {} }),
    })
    if (r.ok) return undefined
    return (await r.text()).trim() || 'That did not send. Try again.'
  } catch {
    return 'That did not send. Check the connection and try again.'
  }
}

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

let fields = (shown: Asked[], questions: readonly Question[]): FieldSpec[] =>
  shown.map(({ question: { question: q, entity }, path, entries }) => ({
    path,
    label: q.label,
    required: q.required,
    hint: q.hint,
    kind: q.kind == 'repeat'
      ? 'repeat'
      : q.kind == 'choose' || q.kind == 'choices'
      ? 'choice'
      : q.kind == 'check' || q.kind == 'file'
      ? q.kind
      : q.kind == 'lines' || q.kind == 'address'
      ? 'lines'
      : 'text',
    ...(input[q.kind] ?? {}),
    options: q.choices,
    multiple: q.kind == 'choices',
    entries: entries?.map((shown) => fields(shown, questions)),
    blank: q.kind == 'repeat' ? entry(questions, entity.eid) : undefined,
  }))

/** Form-specific transport can be replaced by the embedding page. */
export type FillProps =
  & Pick<SubmitProps<Door>, 'at' | 'e' | 'onChange' | 'drafts'>
  & {
    read?: Read
    send?: Send
    upload?: Upload
  }

/** Props for Submit, including visible Fields, validation and native feedback. */
export let fill = (
  {
    at,
    e,
    onChange,
    drafts,
    read = get,
    send = post,
    upload: sendFile = upload,
  }: FillProps,
): SubmitProps<Door> => {
  let base = globalThis.document?.baseURI || globalThis.location?.href
  // Preserve the durable draft address across the kit refactor.
  let place = `signup:${
    derivedEid(`Signup|${base ? new URL(at, base).href : at}`)
  }`
  return {
    at,
    e,
    onChange,
    place,
    drafts,
    read,
    send,
    loading: 'Loading the form…',
    initial: fresh,
    upload: async (at, path, file) => {
      let result = await sendFile(at, String(path.at(-1)), file)
      return typeof result == 'string' ? result : { value: result.eid }
    },
    feedback: () => {
      let page = globalThis.location?.href
      let result = page &&
        returned(at, page, globalThis.document?.baseURI || page)
      if (!result) return
      let url = new URL(page)
      url.searchParams.delete('yak-form')
      globalThis.history?.replaceState(globalThis.history.state, '', url.href)
      return result
    },
    render: ({ content, state, change, send, file }) =>
      drawn(at, content, state, change, send, file),
  }
}

let drawn = (
  at: string,
  door: Door,
  state: SubmitState<Door>,
  emit: (change: SubmitState<Door>) => void,
  send: Send,
  file: (path: (string | number)[], chosen: File) => Promise<void>,
): JSX.Element => {
  let { doc = {}, form: settings, open, questions } = door
  let rows: Rows = { form: settings, questions }
  let answers = state.values ?? fresh(door)
  let title = doc.title ? h('h2', {}, doc.title) : null

  if (state.sent) {
    return h(
      'section',
      { class: 'Submit', role: 'status' },
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
      { class: 'Submit' },
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
  let submit = async (ev: Event) => {
    ev.preventDefault()
    if (state.sending) return
    let sending = kept(rows, answers)
    if (missing(rows, sending).length) return emit({ tried: true })
    let trap = (ev.target as HTMLFormElement | null)?.querySelector?.(
      `[name="${SIGNS.trap}"]`,
    ) as HTMLInputElement | null
    let signs: Signs = {
      trap: trap?.value ?? '',
      ...state.shown == null ? {} : { took: Date.now() - state.shown },
    }
    emit({ values: answers, tried: true, sending: true, said: undefined })
    let said = await send(at, sending, signs)
    emit(
      said == null ? { sending: false, sent: true } : { sending: false, said },
    )
  }

  return h(
    'section',
    { class: 'Submit' },
    title,
    paragraphs(doc.body),
    h(
      Form,
      { method: 'post', action: at, onSubmit: submit },
      h(Fields, {
        at,
        fields: fields(asked(rows, answers), questions),
        values: answers,
        disabled: state.sending,
        owed,
        onChange: (path, value) =>
          emit({ values: put(answers, path, value), said: undefined }),
        onFile: file,
      }),
      // What a person never sees and a bot fills in; the door holds a
      // sign-up that comes with it filled.
      h(
        Form.Trap,
        { 'aria-hidden': 'true' },
        h(
          'label',
          {},
          'Leave this empty ',
          h('input', {
            name: SIGNS.trap,
            tabindex: '-1',
            autocomplete: 'off',
            disabled: state.sending,
          }),
        ),
      ),
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
