// Who a signed-in person is among an app's own people (T-153688). A church
// directory already holds its members' numbers and addresses; a member who
// signs in with one of them is that row, whatever account they signed in
// with. Only what the platform proved is theirs is compared: the number a
// code was texted to and the address a code was mailed to, never a typed
// answer. Which row that is, is @yaks/people's to say.
import type { Bundle } from '@yaks/graph'
import { e164 } from '@yaks/phone/mobile'
import { seeking, whose } from '@yaks/people'
import { directoryOf } from './directory.ts'
import type { Stored } from './graph.ts'

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

/** The row of this app's own people that `person` is, or undefined. */
export let recognized = async (
  at: Stored,
  person: string | null,
): Promise<Bundle | undefined> => {
  if (!person || !at.env.STORE) return undefined
  let held = await proved(at, person)
  let rows = await Promise.all(
    seeking(at.graph.vocab, held).map((line) => at.graph.read(line)),
  )
  return whose(rows.flat(), held)
}
