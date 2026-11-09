// Availability and completion are checked in the registration’s transaction.
import { type Answers, type Form, missing, open } from '@yaks/forms'
import { composed } from '@yaks/graph/bundle'
import { after, each } from '@yaks/fp'
import { type Bundle, type Comp, hook, type Plugin } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'

let comp = (row: Bundle | undefined, name: string): Comp =>
  row?.[name] as Comp ?? {}
let quote = (value: unknown) => JSON.stringify(value)
/** A form's accepted registrations, read only as far as its capacity, which
 * is all `open` needs of the count. */
export let accepted = (id: string, capacity: number) =>
  `.registration.form=${quote(id)}&.completed&!cancelled&!waitlisted&.limit=${
    Math.max(1, capacity)
  }`
export let formRules = (
  now: () => number,
): Plugin => ({
  name: 'yak/forms',
  admission: () => true,
  hooks: {
    rules: hook(['registration', 'completed'], (bundles, tx) => {
      let rows = composed(bundles), counts = new Map<string, number>()
      let complete = (row: Bundle) =>
        after(tx.get([row.entity.eid]), ([before]) => {
          if (before?.completed) return
          let registration = {
            ...comp(before, 'registration'),
            ...comp(row, 'registration'),
          }
          if (
            !registration.form || row.cancelled || row.waitlisted ||
            before?.cancelled || before?.waitlisted
          ) return
          let id = String(registration.form)
          return after(tx.get([id]), ([source]) => {
            if (!source?.form) throw new Refused('No such form.')
            return after(
              tx.read(`.question.form=${quote(id)}`),
              (questions) => {
                let form: Form = {
                  form: comp(source, 'form'),
                  questions: questions as unknown as Form['questions'],
                }
                let answers = registration.answers as Answers ?? {}
                if (missing(form, answers).length) {
                  throw new Refused('Answer every required question.')
                }
                return after(
                  form.form.capacity == null
                    ? []
                    : tx.read(accepted(id, form.form.capacity), undefined, []),
                  (held) => {
                    let count = counts.get(id) ?? held.length
                    if (!open(form, now(), count)) {
                      throw new Refused('This form is closed or full.')
                    }
                    counts.set(id, count + 1)
                  },
                )
              },
            )
          })
        })
      return after(
        each<Bundle, void>(
          rows.filter((b) => b.completed),
          undefined,
          (_, row) => complete(row),
        ),
        () => bundles,
      )
    }),
  },
})
