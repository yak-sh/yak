// Letters are separate writes so their bodies pass through blob preparation.
import { answered, type Answers, type Form } from '@yaks/forms'
import { type Bundle, type Comp, derivedEid, signed } from '@yaks/graph'
import type { Handler } from '@yaks/effects'
import type { Stored } from './graph.ts'

let comp = (row: Bundle | undefined, name: string): Comp =>
  row?.[name] as Comp ?? {}
let address = (row: Bundle | undefined) =>
  comp(row, 'email').address ?? comp(row, 'individual').email
let letter = (
  registration: string,
  purpose: string,
  to: string,
  title: string,
  body: string,
): Bundle[] => {
  let person = derivedEid(
    JSON.stringify(['form-address', registration, purpose, to]),
  )
  return [{ entity: { eid: person }, email: { address: to } }, {
    entity: {
      eid: derivedEid(
        JSON.stringify(['form-letter', registration, purpose, to]),
      ),
    },
    doc: { title, body },
    mail: { target: registration },
    deliver: { to: person },
  }]
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
    let email =
      answered(form, registration.answers as Answers ?? {}).find((a) =>
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
        `A new sign-up for ${title}.`,
      ]),
    ]
    for (let [to, purpose, body] of recipients) {
      if (typeof to != 'string' || !to.trim()) continue
      let batch = letter(row.entity.eid, purpose, to.trim(), title, body)
      if ((await at.graph.get([batch[1].entity.eid])).length) continue
      await at.graph.apply(signed(batch, { by: at.app }))
    }
  }
