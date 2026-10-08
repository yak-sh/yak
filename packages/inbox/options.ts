// What a config passes to @yaks/inbox: its email door, all of it optional.
//
// ```json
// { "use": "@yaks/inbox",
//   "with": { "person": "<person eid>",
//             "from": "inbox@books.example",
//             "base": "https://books.example",
//             "hour": 9 } }
// ```
//
// `./service` reads all of it to queue letters, and `./mail` reads `person`
// and `from` to read the letters that come back. A config that names no
// person opens no door: the inbox is then only what its views and tools show.

import type { Eid } from '@yaks/graph'

/** What a config passes to @yaks/inbox. */
export type Options = {
  /** whose inbox reaches a mail client; letters from them may answer it */
  person?: Eid
  /** the inbox address: letters go out from it, and a verified letter from
   * `person` to it starts a conversation */
  from?: string
  /** where a letter's thread links point: this graph's web address */
  base?: string
  /** the UTC hour after which the day's one digest is queued (default 9) */
  hour?: number
  /** email alerts too; they are never sent unless asked for */
  alerts?: boolean
  /** email updates too; they are never sent unless asked for */
  updates?: boolean
  /** how long the service waits between passes, in milliseconds (default ten
   * seconds) */
  every?: number
}

/** An email door that can send: a person, an address and a link base. */
export type Door = Options & { person: Eid; from: string; base: string }

/** The door the options open, or none. */
export let door = (options: Options = {}): Door | undefined =>
  options.person && options.from && options.base ? options as Door : undefined
