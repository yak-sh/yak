import type { Bundle, Comp } from '@yaks/graph'
import { texterEid } from './form-phone.ts'
import type { Rule } from './mover.ts'

/** Only the derived phone row text sign-up created is the form's. */
export let formPhoneMove = (
  row: Bundle,
  read: (line: string) => Bundle[],
): Bundle[] => {
  let submitter = String((row.registration as Comp).submitter)
  let [phone] = read(`.entity.eid=${texterEid(submitter)}&.phone&!form_phone`)
  return phone ? [{ entity: phone.entity, form_phone: { submitter } }] : []
}

export let formPhoneRule: Rule = {
  mark: 'yak/store/form-phone/1',
  stores: 'apps',
  live: 'apps',
  core: ['registration', 'phone', 'form_phone'],
  find: '.registration.submitter',
  move: (row, read) => {
    if (!read) throw new Error('a form phone is known by its texter')
    return formPhoneMove(row, read)
  },
}
