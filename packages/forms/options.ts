// What a host gives the forms plugin: its clock, how its rows reach the
// graph, the page that shows a sign-up, and who of the app's own people a
// signed-in person is.

import type { Bundle } from '@yaks/graph'

/** The forms plugin's options, each with a default for a host that says
 * nothing. */
export type Options = {
  /** the host's clock, which a form's opening and closing are read by;
   * `Date.now` by default */
  now?: () => number
  /** how the rows this plugin writes are written, such as signed as the
   * app: a sign-up's letters, and the registration a form's door files.
   * A refusal it throws is the door's answer. The effect's own write, and
   * the host's graph at the door, by default */
  post?: (rows: Bundle[]) => unknown
  /** the address of the app's pages, before a form's `seen`; asked at send
   * time, and without one the alert links nowhere */
  site?: () => string | undefined
  /** where a person the form notifies is written to when their row has no
   * `email{address}`, such as an address an app's people keep */
  addressOf?: (row: Bundle | undefined) => unknown
  /** the row of the app's own people a signed-in person is, which the door
   * fills their form in from and names on their sign-up; nobody by default,
   * as a host that proves no one's number or address knows nobody */
  known?: (person: string) => Promise<Bundle | undefined>
}
