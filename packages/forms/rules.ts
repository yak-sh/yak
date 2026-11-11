// Availability and completion are checked in the registration’s transaction,
// and what its sender chose to share is written beside it.
import {
  accepted,
  answered,
  type Answers,
  type Form,
  missing,
  open,
  shared,
} from './mod.ts'
import { composed } from '@yaks/graph/bundle'
import { after, each } from '@yaks/fp'
import {
  type Bundle,
  type Comp,
  derivedEid,
  hook,
  type Plugin,
} from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'

let comp = (row: Bundle | undefined, name: string): Comp =>
  row?.[name] as Comp ?? {}
let quote = (value: unknown) => JSON.stringify(value)
// A retried completion finds the same shared row again.
let share = (registration: string) =>
  derivedEid(JSON.stringify(['registration-shared', registration]))

/** The rules a registration is accepted by, read against `now`. */
export let formRules = (
  now: () => number,
): Plugin => ({
  name: '@yaks/forms',
  admission: () => true,
  hooks: {
    rules: hook(['registration', 'completed'], (bundles, tx) => {
      let rows = composed(bundles), counts = new Map<string, number>()
      let out = [...bundles]
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
                let files = [
                  ...new Set(
                    answered(form, answers).filter((a) =>
                      a.question.question.kind == 'file'
                    ).map((a) => a.value),
                  ),
                ]
                if (
                  files.some((id) =>
                    typeof id != 'string' || !/^[a-f0-9]{64}$/.test(id)
                  )
                ) {
                  throw new Refused('Upload a file for every file answer.')
                }
                return after(
                  files.length ? tx.get(files as string[], ['blob']) : [],
                  (blobs) => {
                    if (
                      blobs.length != files.length || blobs.some((b) => !b.blob)
                    ) {
                      throw new Refused('Upload a file for every file answer.')
                    }
                    return after(
                      form.form.capacity == null ? [] : tx.read(
                        accepted(id, form.form.capacity),
                        undefined,
                        [],
                      ),
                      (held) => {
                        let count = counts.get(id) ?? held.length
                        if (!open(form, now(), count)) {
                          throw new Refused('This form is closed or full.')
                        }
                        counts.set(id, count + 1)
                        let told = shared(form, answers)
                        if (!told) return
                        out.push({
                          entity: { eid: share(row.entity.eid) },
                          shared: {
                            form: id,
                            registration: row.entity.eid,
                            answers: told,
                            at: registration.at ??
                              new Date(now()).toISOString(),
                          },
                        })
                      },
                    )
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
        () => out,
      )
    }),
  },
})
