// The form conversation keeps its progress in the registration, in the app.
// Only the kernel brings a vouched submitter to this door.
import {
  type Answers,
  type Form,
  missing,
  next,
  open,
  prefilled,
} from '@yaks/forms'
import { type Bundle, type Comp, derivedEid, mint, signed } from '@yaks/graph'
import { consentEid } from '@yaks/phone'
import { Refused } from '@yaks/graph/errors'
import type { Stored } from './graph.ts'
import { accepted } from './form-rules.ts'
import { calendarScope, personalFeed } from './calendar.ts'

let comp = (row: Bundle | undefined, name: string): Comp =>
  row?.[name] as Comp ?? {}
let quoted = (value: unknown) => JSON.stringify(value)
let fields = (row: Comp, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]),
  )

let definition = async (at: Stored, id: string) => {
  let named = await at.graph.address([id], 'form')
  let [row] = await at.graph.get([named.get(id) ?? id], [
    'form',
    'doc',
    'alias',
  ])
  if (!row?.form) throw new Refused('No such form.')
  let form: Form = {
    form: comp(row, 'form'),
    questions: await at.graph.read(
      `.question.form=${quoted(row.entity.eid)}`,
    ) as unknown as Form['questions'],
  }
  return { row, form }
}

let available = async (at: Stored, row: Bundle) => {
  let form = comp(row, 'form')
  let held = form.capacity == null
    ? []
    : await at.graph.read(accepted(row.entity.eid, Number(form.capacity)))
  return open({ form }, at.now(), held.length)
}

let link = async (at: Stored, person: string, replace = false) =>
  `calendar/${(await personalFeed(at, person, replace)).feed.token}.ics`

let progress = async (
  at: Stored,
  row: Bundle,
  form: Form,
  person: string,
) => ({
  registration: row.entity.eid,
  form: comp(row, 'registration').form,
  answers: comp(row, 'registration').answers ?? {},
  completed: !!row.completed,
  next: next(form, comp(row, 'registration').answers as Answers ?? {}) ?? null,
  thanks: form.form.thanks,
  calendar: await link(at, person),
})

// A path comes only from next(), never from a model-supplied property name.
let answering = (
  answers: Answers,
  path: (string | number)[],
  value: unknown,
) => {
  let out = structuredClone(answers) as Record<string, unknown>
  let scope: Record<string, unknown> | unknown[] = out
  for (let key of path.slice(0, -1)) {
    scope = (scope as Record<string | number, unknown>)[key] as typeof scope
  }
  ;(scope as Record<string | number, unknown>)[path.at(-1)!] = value
  return out
}

// The texting number is theirs: the platform received the text from it.
let initial = async (at: Stored, form: Form, phone: string) => {
  let [person] = await at.graph.read(
    `.phone.number=${quoted(phone)}${
      at.graph.vocab.comp('individual') ? '&?individual' : ''
    }&.limit=1`,
  )
  return prefilled(form, {
    ...person,
    individual: { ...comp(person, 'individual'), phone },
  })
}

export let signupIn = async (req: Request, at: Stored): Promise<Response> => {
  let args = await req.json() as {
    op: string
    person: string
    phone: string
    space?: string
    form?: string
    registration?: string
    path?: (string | number)[]
    value?: unknown
    replace?: boolean
  }
  if (!at.app || !args.person || !args.phone) {
    return Response.json({ message: 'No sign-up identity.' }, { status: 400 })
  }
  let mine = `.registration.submitter=${quoted(args.person)}`
  try {
    if (args.op == 'forms') {
      let rows = await at.graph.read('.form&?doc&?alias')
      let shown = await Promise.all(
        rows.map(async (row) =>
          await available(at, row)
            ? {
              entity: { eid: row.entity.eid },
              doc: fields(comp(row, 'doc'), ['title', 'body']),
              alias: comp(row, 'alias').name,
            }
            : null
        ),
      )
      return Response.json(shown.filter(Boolean))
    }
    if (args.op == 'mine') {
      let rows = await at.graph.read(`${mine}&?completed&!cancelled`)
      return Response.json(
        await Promise.all(rows.map(async (row) => {
          let { form } = await definition(
            at,
            String(comp(row, 'registration').form),
          )
          return progress(at, row, form, args.person)
        })),
      )
    }
    if (args.op == 'start') {
      let { row: source, form } = await definition(at, args.form ?? '')
      let [held] = await at.graph.read(
        `${mine}&.registration.form=${
          quoted(source.entity.eid)
        }&!cancelled&?completed&.limit=1`,
      )
      if (held) {
        return Response.json(await progress(at, held, form, args.person))
      }
      if (!await available(at, source)) {
        throw new Refused('This form is closed or full.')
      }
      let answers = await initial(at, form, args.phone)
      let id = mint()
      await at.graph.apply(signed([{
        entity: { eid: id },
        registration: {
          form: source.entity.eid,
          submitter: args.person,
          answers,
          at: new Date(at.now()).toISOString(),
        },
        ...missing(form, answers).length ? {} : { completed: {} },
      }], { by: at.app }))
      let [row] = await at.graph.get([id])
      return Response.json(await progress(at, row, form, args.person))
    }
    if (args.op != 'answer' && args.op != 'calendar') {
      throw new Refused('No such sign-up operation.')
    }
    if (args.op == 'calendar') {
      let [row] = await at.graph.read(
        `${await calendarScope(at, args.person)}${
          args.registration ? `&.entity.eid=${quoted(args.registration)}` : ''
        }&.limit=1`,
      )
      if (!row) throw new Refused('No such registration.')
      return Response.json({
        calendar: await link(at, args.person, args.replace === true),
      })
    }
    let [row] = await at.graph.read(
      `${mine}&.entity.eid=${
        quoted(args.registration ?? '')
      }&?completed&!cancelled`,
    )
    if (!row) throw new Refused('No such registration.')
    let { form } = await definition(at, String(comp(row, 'registration').form))
    let answers = comp(row, 'registration').answers as Answers ?? {}
    let owed = next(form, answers)
    if (!owed) return Response.json(await progress(at, row, form, args.person))
    if (quoted(args.path) != quoted(owed.path)) {
      throw new Refused(
        'That question has changed. Read your registration again.',
      )
    }
    if (
      args.value === undefined ||
      args.value === null && owed.question.question.required
    ) {
      throw new Refused(
        'Answer this required question; only optional questions can be skipped.',
      )
    }
    let updated = answering(answers, owed.path, args.value)
    let question = owed.question.question
    let agreed = question.fills == 'sms_consent.consent' &&
      (args.value === true ||
        typeof args.value == 'string' && /^yes$/i.test(args.value.trim()))
    let [texter] = agreed
      ? await at.graph.read(`.phone.number=${quoted(args.phone)}&.limit=1`)
      : []
    let person = texter?.entity.eid ?? derivedEid('form-texter|' + args.person)
    let consent: Bundle[] = agreed
      ? [
        { entity: { eid: person }, phone: { number: args.phone } },
        {
          entity: { eid: consentEid(person) },
          sms_consent: {
            person,
            consent: [question.label, question.hint].filter(Boolean).join('\n'),
            at: new Date(at.now()).toISOString(),
            ...args.space ? { space: args.space } : {},
          },
        },
      ]
      : []
    await at.graph.apply(signed([{
      entity: row.entity,
      registration: { answers: updated },
      ...row.completed || missing(form, updated).length
        ? {}
        : { completed: {} },
    }, ...consent], { by: at.app }))
    return Response.json(
      await progress(
        at,
        {
          ...row,
          registration: {
            ...comp(row, 'registration'),
            answers: updated,
          },
          ...missing(form, updated).length ? {} : { completed: {} },
        },
        form,
        args.person,
      ),
    )
  } catch (error) {
    if (!(error instanceof Refused)) throw error
    return Response.json({ message: error.message }, { status: 400 })
  }
}
