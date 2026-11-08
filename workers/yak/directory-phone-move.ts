// One-time repair of directory numbers written before phone{number} was kept.
import type { Bundle, Comp } from '@yaks/graph'
import { directoryPhone } from './form-directory.ts'
import type { Rule } from './mover.ts'

export let directoryPhoneMove = (row: Bundle): Bundle[] => {
  let next = directoryPhone(row)
  return (next.phone as Comp | undefined)?.number ==
      (row.phone as Comp | undefined)?.number
    ? []
    : [{ entity: row.entity, phone: next.phone }]
}

export let directoryPhoneRule: Rule = {
  mark: 'yak/store/directory-phone/1',
  stores: 'apps',
  find: '.individual.phone&?phone',
  move: directoryPhoneMove,
}
