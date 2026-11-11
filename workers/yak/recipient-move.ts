// The addresses letters were written to before `recipient` (T-159245): an
// `email{address}` row a letter's `deliver.to` names and that is nothing but an
// address is kept to the app's owners and editors, as the letter is, so a
// stranger reading a public or open app no longer lists who was written to.
// A row the app also gave something of its own is left as the app wrote it.
import { bare } from '@yaks/mail'
import type { Bundle } from '@yaks/graph'
import type { Rule } from './mover.ts'

/** The `recipient` one address row is owed: it is only an address, and a
 * letter, found through `read`, is for it. */
export let recipientMove = (
  row: Bundle,
  read: (line: string) => Bundle[],
): Bundle[] =>
  bare(row) && read(`.deliver.to=${row.entity.eid}&.limit=1`).length
    ? [{ entity: row.entity, recipient: {} }]
    : []

export let recipientRule: Rule = {
  mark: 'yak/store/recipient/1',
  stores: 'apps',
  live: 'apps',
  core: ['email', 'deliver', 'recipient'],
  find: '.email&!recipient&?*',
  move: (row, read) => {
    if (!read) throw new Error('an address is known by its letters')
    return recipientMove(row, read)
  },
}
