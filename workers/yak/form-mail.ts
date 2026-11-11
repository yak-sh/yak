// Letters are separate writes so their bodies pass through blob preparation.
import { answered, type Answers, type Form } from '@yaks/forms'
import { type Bundle, type Comp, derivedEid, signed } from '@yaks/graph'
import type { Handler } from '@yaks/effects'
import type { Stored } from './graph.ts'

let comp = (row: Bundle | undefined, name: string): Comp =>
  row?.[name] as Comp ?? {}
let address = (row: Bundle | undefined) =>
  comp(row, 'email').address ?? comp(row, 'individual').email
/** The purposes a form writes a sign-up's letters for: the thanks to the
 * person who signed up, and the word to each person the form notifies. */
export let PURPOSES = ['confirm', 'notify'] as const

/** The eids of one of a sign-up's letters and of the address it goes to. */
export let lettered = (registration: string, purpose: string, to: string) => ({
  address: derivedEid(
    JSON.stringify(['form-address', registration, purpose, to]),
  ),
  letter: derivedEid(
    JSON.stringify(['form-letter', registration, purpose, to]),
  ),
})

let letter = (
  registration: string,
  purpose: string,
  to: string,
  title: string,
  body: string,
): Bundle[] => {
  let eid = lettered(registration, purpose, to)
  // The letter wears `mail`, which keeps it to the app's owners and editors.
  // Its address is a row of the app's store too, which in a public or open
  // app anybody reads; `form_mail` keeps both to them, as the sign-up is.
  let form_mail = { registration, purpose }
  return [
    { entity: { eid: eid.address }, email: { address: to }, form_mail },
    {
      entity: { eid: eid.letter },
      doc: { title, body },
      mail: { target: registration },
      deliver: { to: eid.address },
      form_mail,
    },
  ]
}

// An answer as a line of a letter: a list said as its items, a tick as yes
// or no, and anything that is not words (a file) left out.
let said = (value: unknown): string =>
  Array.isArray(value)
    ? value.map(said).filter(Boolean).join(', ')
    : typeof value == 'boolean'
    ? value ? 'Yes' : 'No'
    : typeof value == 'string' || typeof value == 'number'
    ? String(value).trim()
    : ''

/**
 * What the people a form notifies are told of a sign-up: that there is one,
 * then each question answered and its answer, so they need not open the app
 * to learn who it was. The entries of a repeat are numbered and set apart, so
 * each child or helper reads as one person.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let ask = (eid: string, label: string, order: number, within?: string, kind = 'line') => ({
 *   entity: { eid },
 *   question: { form: 'f', label, kind: kind as 'line', order, within },
 * })
 * let form = { form: {}, questions: [ask('n', 'Your name', 1), ask('h', 'How can we help?', 2), ask('c', 'Child', 3, undefined, 'repeat'), ask('k', 'Name', 4, 'c')] }
 * assertEquals(
 *   told(form, { n: 'Linda Park', h: 'A ride on Sunday', c: [{ k: 'Bo' }, { k: 'Cy' }] }, 'Visitor card'),
 *   'A new sign-up for Visitor card.\n\n- Your name: Linda Park\n- How can we help? A ride on Sunday\n\nChild 1\n- Name: Bo\n\nChild 2\n- Name: Cy',
 * )
 * assertEquals(told(form, {}, 'Visitor card'), 'A new sign-up for Visitor card.')
 * ```
 */
export let told = (form: Form, answers: Answers, title: string): string => {
  let heads = new Map(
    form.questions.map((
      q,
    ) => [q.entity.eid, String(q.question.label ?? '').trim()]),
  )
  let scope = ''
  let blocks: string[][] = [[]]
  for (let { question, path, value } of answered(form, answers)) {
    let label = String(question.question.label ?? '').trim(), is = said(value)
    if (!is) continue
    let [repeat, index] = path.length > 1 ? path : []
    let at = repeat == null ? '' : `${repeat} ${index}`
    if (at != scope) {
      scope = at
      blocks.push(
        repeat == null
          ? []
          : [`${heads.get(String(repeat))} ${Number(index) + 1}`],
      )
    }
    blocks.at(-1)!.push(`- ${label}${/[?:.!]$/.test(label) ? '' : ':'} ${is}`)
  }
  return [
    `A new sign-up for ${title}.`,
    ...blocks.filter((b) => b.length).map((b) => b.join('\n')),
  ]
    .join('\n\n')
}

export let formPost =
  (at: Pick<Stored, 'app' | 'graph'>): Handler => async (event) => {
    let [row] = await at.graph.get([event.entity.eid])
    if (!at.app || !row?.registration || !row.completed) return
    let registration = comp(row, 'registration'),
      formId = String(registration.form)
    let [source] = await at.graph.get([formId])
    if (!source?.form) return
    let form: Form = {
      form: comp(source, 'form'),
      questions: await at.graph.read(
        `.question.form=${JSON.stringify(formId)}`,
      ) as unknown as Form['questions'],
    }
    let person = String(registration.person ?? '')
    let notify = [...(form.form.notify ?? [])]
    let people = await at.graph.get([...notify, ...person ? [person] : []])
    let title = String(comp(source, 'doc').title ?? 'Sign-up')
    let answers = registration.answers as Answers ?? {}
    let email = answered(form, answers).find((a) =>
      a.path.length == 1 &&
      (a.question.question.kind == 'email' ||
        a.question.question.fills == 'individual.email')
    )?.value ?? address(people.find((b) => b.entity.eid == person))
    let recipients: [unknown, string, string][] = [
      [
        email,
        'confirm',
        form.form.thanks ?? `Thank you for signing up for ${title}.`,
      ],
      ...people.filter((b) => notify.includes(b.entity.eid)).map((
        b,
      ): [unknown, string, string] => [
        address(b),
        'notify',
        told(form, answers, title),
      ]),
    ]
    for (let [to, purpose, body] of recipients) {
      if (typeof to != 'string' || !to.trim()) continue
      let subject = purpose == 'notify' ? `New sign-up: ${title}` : title
      let batch = letter(row.entity.eid, purpose, to.trim(), subject, body)
      if ((await at.graph.get([batch[1].entity.eid])).length) continue
      await at.graph.apply(signed(batch, { by: at.app }))
    }
  }
