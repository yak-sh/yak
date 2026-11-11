// The letters a form wrote before they wore `form_mail` (bd4d27a92), and the
// addresses they went to, given it, so a stranger reading a public or open app
// no longer lists who signed up (T-157871). A letter is the form's when its
// eid and its address's are the ones form-mail.ts derives for it; an app's own
// letter about a sign-up, and the address row it went to, are left as the app
// wrote them.
import type { Bundle, Comp } from '@yaks/graph'
import { lettered, PURPOSES } from './form-mail.ts'
import type { Rule } from './mover.ts'

let comp = (row: Bundle | undefined, name: string): Comp =>
  row?.[name] as Comp ?? {}

/** The `form_mail` one form letter and its address are owed, its address read
 * through `read`; nothing for any other letter. */
export let formMailMove = (
  row: Bundle,
  read: (line: string) => Bundle[],
): Bundle[] => {
  let registration = String(comp(row, 'mail').target ?? '')
  let to = String(comp(row, 'deliver').to ?? '')
  if (!registration || !to) return []
  let [recipient] = read(`.entity.eid=${to}&?email`)
  let address = String(comp(recipient, 'email').address ?? '')
  let purpose = PURPOSES.find((purpose) => {
    let eid = lettered(registration, purpose, address)
    return eid.letter == row.entity.eid && eid.address == to
  })
  if (!purpose) return []
  let form_mail = { registration, purpose }
  return [{ entity: row.entity, form_mail }, { entity: { eid: to }, form_mail }]
}

export let formMailRule: Rule = {
  mark: 'yak/store/form-mail/1',
  stores: 'apps',
  live: 'apps',
  core: ['registration', 'form_mail', 'mail', 'deliver', 'email'],
  find: '.mail.target.registration&.deliver.to&!form_mail&?mail&?deliver',
  move: (row, read) => {
    if (!read) throw new Error('a form letter is known by its address')
    return formMailMove(row, read)
  },
}
