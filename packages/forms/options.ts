// What a host gives the forms plugin: its clock, and how a sign-up's letters
// reach the graph and the page that shows a sign-up.

import type { Bundle } from '@yaks/graph'

/** The forms plugin's options, each with a default for a host that says
 * nothing. */
export type Options = {
  /** the host's clock, which a form's opening and closing are read by;
   * `Date.now` by default */
  now?: () => number
  /** how a sign-up's letters are written, such as signed as the app; the
   * effect's own write by default */
  post?: (letters: Bundle[]) => unknown
  /** the address of the app's pages, before a form's `seen`; asked at send
   * time, and without one the alert links nowhere */
  site?: () => string | undefined
  /** where a person the form notifies is written to when their row has no
   * `email{address}`, such as an address an app's people keep */
  addressOf?: (row: Bundle | undefined) => unknown
}
