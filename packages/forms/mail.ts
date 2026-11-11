// The letters a completed sign-up owes: its thanks to the person who signed
// up and the word to each person the form notifies. Letters are separate
// writes so their bodies pass through blob preparation.
import { answered, type Answers, type Form } from './mod.ts'
import { type Bundle, type Comp, derivedEid } from '@yaks/graph'
import type { Handler } from '@yaks/effects'
import type { Options } from './options.ts'

let comp = (row: Bundle | undefined, name: string): Comp =>
  row?.[name] as Comp ?? {}
/** The purposes a form writes a sign-up's letters for: the thanks to the
 * person who signed up, and the word to each person the form notifies. */
export let PURPOSES: readonly ['confirm', 'notify'] = ['confirm', 'notify']

/** The eids of one of a sign-up's letters and of the address it goes to. */
export let lettered = (
  registration: string,
  purpose: string,
  to: string,
): { address: string; letter: string } => ({
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
  mail: Comp = {},
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
      mail: { target: registration, ...mail },
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
 * import { told } from '@yaks/forms/effects'
 * import { equal } from '@yaks/testing'
 * let ask = (eid: string, label: string, order: number, within?: string, kind = 'line') => ({
 *   entity: { eid },
 *   question: { form: 'f', label, kind: kind as 'line', order, within },
 * })
 * let form = { form: {}, questions: [ask('n', 'Your name', 1), ask('h', 'How can we help?', 2), ask('c', 'Child', 3, undefined, 'repeat'), ask('k', 'Name', 4, 'c')] }
 * equal(
 *   told(form, { n: 'Linda Park', h: 'A ride on Sunday', c: [{ k: 'Bo' }, { k: 'Cy' }] }, 'Visitor card'),
 *   'A new sign-up for Visitor card.\n\n- Your name: Linda Park\n- How can we help? A ride on Sunday\n\nChild 1\n- Name: Bo\n\nChild 2\n- Name: Cy',
 * )
 * equal(told(form, {}, 'Visitor card'), 'A new sign-up for Visitor card.')
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

/** `form_post`: write a completed sign-up's letters, each once however often
 * it is retried. A sign-up still held for a bot's writes none until it is
 * accepted. */
export let formPost =
  (options: Options = {}): Handler => async (event, tx, write) => {
    let [row] = await tx.get([event.entity.eid])
    if (!row?.registration || !row.completed || row.held) return
    let address = (b: Bundle | undefined) =>
      comp(b, 'email').address ?? options.addressOf?.(b)
    let registration = comp(row, 'registration'),
      formId = String(registration.form)
    let [source] = await tx.get([formId])
    if (!source?.form) return
    let form: Form = {
      form: comp(source, 'form'),
      questions: await tx.read(
        `.question.form=${JSON.stringify(formId)}`,
      ) as unknown as Form['questions'],
    }
    let person = String(registration.person ?? '')
    let notify = [...(form.form.notify ?? [])]
    let people = await tx.get([...notify, ...person ? [person] : []])
    let title = String(comp(source, 'doc').title ?? 'Sign-up')
    let answers = registration.answers as Answers ?? {}
    let email = answered(form, answers).find((a) =>
      a.path.length == 1 &&
      (a.question.question.kind == 'email' ||
        a.question.question.fills?.endsWith('.email'))
    )?.value ?? address(people.find((b) => b.entity.eid == person))
    // The page the form says shows a sign-up, if it says.
    let site = options.site?.(), page = form.form.seen
    let open = site && page
      ? `\n\nSee it: ${site}${page.replaceAll('{id}', row.entity.eid)}`
      : ''
    let replies = typeof email == 'string' && email.trim()
      ? { reply_address: email.trim() }
      : {}
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
        told(form, answers, title) + open,
      ]),
    ]
    let post = options.post ?? write
    for (let [to, purpose, body] of recipients) {
      if (typeof to != 'string' || !to.trim()) continue
      let subject = purpose == 'notify' ? `New sign-up: ${title}` : title
      let batch = letter(
        row.entity.eid,
        purpose,
        to.trim(),
        subject,
        body,
        purpose == 'notify' ? replies : {},
      )
      if ((await tx.get([batch[1].entity.eid])).length) continue
      await post(batch)
    }
  }
