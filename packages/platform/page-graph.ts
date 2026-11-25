/**
 * A signed-in tab's one page graph (D-475): a @yaks/client over the page
 * graph's door, which reads, writes and watches across every store the
 * person reaches (yaks.app's reach-door.ts). Every script on the page asks for
 * it here and gets the same one (@yaks/client `shared`), grown with the words
 * each brings. It says where its tab is (@yaks/notify/tab), which its door
 * says on to the Operator whose conversation the tab watches. It holds
 * nothing on disk yet. A page the server drew from rows
 * carries them (`drawnRows`), and the graph starts holding them, shown until
 * each subscription answers. Off a page (a test), its door is at
 * `http://page`, which nothing is sent to until a write or a watch asks.
 *
 * @module
 */
import { type Client, shared, wireStash } from '@yaks/client'
import type { Bundle } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'

/** The page graph's door: `/query`, `/apply` and `/ws` under it. No space
 * can be named `account` (./names.ts), so it is no space's page. */
export let REACH = '/manage/account/reach'

/** The header on writes and the query parameter on socket upgrades identifying
 * the person the tab was drawn for. The door compares it with the session. */
export let TAB_PERSON = 'x-yak-tab-person'

/** The rows a page was drawn from, as the page carries them. */
export type Drawn = { person: string; epoch: string; rows: Bundle[] }

/** Where a page carries the rows it was drawn from. */
export let DRAWN = 'script[data-page-graph]'

/** What a page carries of the rows `person`'s page was drawn from, as the
 * text of its `DRAWN` script: JSON with nothing that could close it. */
export let drawnRows = (person: string, rows: Bundle[]): string =>
  JSON.stringify({ person, epoch: crypto.randomUUID(), rows } as Drawn)
    .replaceAll('<', '\\u003c')

// What the page in `doc` carries for `person`, if anything.
let drawn = (person: string, doc = globalThis.document): Drawn | undefined => {
  let said = doc?.querySelector(DRAWN)?.textContent
  let page = said ? JSON.parse(said) as Drawn : undefined
  return page?.person == person ? page : undefined
}

/** The tab's page graph, drawn for `person`, declaring at least `words`. */
export let pageGraph = (words: VocabDoc[], person: string): Client => {
  let start = drawn(person)
  return shared(
    new URL(REACH, globalThis.location?.href ?? 'http://page').href,
    words,
    {
      vault: false,
      wireVault: start ? wireStash(start) : false,
      epoch: start?.epoch,
      headers: { [TAB_PERSON]: person },
      connect: (url) => {
        let socket = new URL(url)
        socket.searchParams.set(TAB_PERSON, person)
        return new WebSocket(socket)
      },
      outboxScope: `${REACH}:${person}`,
    },
  )
}
