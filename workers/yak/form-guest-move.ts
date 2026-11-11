// The people, and the relations between them, that sign-ups created before
// they wore `form_guest`, so a stranger reading a public or open app no longer
// lists who signed up (T-159339). A row is a sign-up's when it stands at an eid
// the sign-up derives (form-directory.ts `signedUp`); a person the app wrote
// itself, which the sign-up matched, stands elsewhere and is left as it is.
import type { Answers, Form } from '@yaks/forms'
import type { Bundle, Comp } from '@yaks/graph'
import { signedUp } from './form-directory.ts'
import type { Rule } from './mover.ts'

/** The `form_guest` one sign-up's people and relations are owed. */
export let formGuestMove = (
  row: Bundle,
  read: (line: string) => Bundle[],
): Bundle[] => {
  let registration = row.registration as Comp
  let form: Form = {
    form: {},
    questions: read(
      `.question.form=${JSON.stringify(registration.form)}`,
    ) as unknown as Form['questions'],
  }
  let eids = signedUp(
    row.entity.eid,
    form,
    (registration.answers ?? {}) as Answers,
  )
  return read(`.entity.eid=${eids.join(',')}&!form_guest`)
    .filter((held) => held.individual || held.relation)
    .map((held) => ({
      entity: held.entity,
      form_guest: { registration: row.entity.eid },
    }))
}

export let formGuestRule: Rule = {
  mark: 'yak/store/form-guest/1',
  stores: 'apps',
  core: ['registration', 'form_guest'],
  find: '.registration.form',
  move: (row, read) => {
    if (!read) throw new Error('a sign-up is known by the rows it derives')
    return formGuestMove(row, read)
  },
}
