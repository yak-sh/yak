// Who a signed-in person is among an app's own people (T-153688). A church
// directory already holds its members' numbers and addresses; a member who
// signs in with one of them is that row, whatever account they signed in
// with. Only what the platform proved is theirs is compared: the number a
// code was texted to and the address a code was mailed to, never a typed
// answer.
import { type Bundle, dead } from '@yaks/graph'
import { e164 } from '@yaks/phone/mobile'
import { directoryOf } from './directory.ts'
import type { Stored } from './graph.ts'
import { addresses } from './join.ts'

let quoted = (v: string) => JSON.stringify(v)
let living = (row: Bundle) =>
  !dead(row) && (row.individual as { deceased?: unknown })?.deceased !== true

/** What the platform proved of `person`: the number and the address they
 * sign in with, each null where they have none. */
export let proved = async (at: Stored, person: string) => {
  let dir = directoryOf(at.env.STORE!)
  let [phone, email] = await Promise.all([
    dir.phoneAt(person),
    dir.emailAt(person),
  ])
  return { phone: phone && e164(phone), email: email?.trim().toLowerCase() }
}

/**
 * The row of this app's own people that `person` is, or undefined: one
 * wearing their number (`phone{number}`), else, in an app that keeps
 * `individual` rows, one whose `individual.email` lists their address. A row
 * of the deceased is nobody's.
 */
export let recognized = async (
  at: Stored,
  person: string | null,
): Promise<Bundle | undefined> => {
  if (!person || !at.env.STORE) return undefined
  let { phone, email } = await proved(at, person)
  let people = !!at.graph.vocab.comp('individual')
  let also = people ? '&?individual' : ''
  let [byPhone, byEmail] = await Promise.all([
    phone ? at.graph.read(`.phone.number=${quoted(phone)}${also}`) : [],
    email && people
      ? at.graph.read(`.individual.email~=${quoted(email)}&?phone`)
      : [],
  ])
  return byPhone.find(living) ?? byEmail.find((row) =>
    living(row) &&
    addresses((row.individual as { email?: unknown }).email).includes(email!)
  )
}
