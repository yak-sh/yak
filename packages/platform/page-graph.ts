/**
 * A signed-in tab's one page graph (D-475): a @yaks/client over the page
 * graph's door, which reads, writes and watches across every store the
 * person reaches (yaks.app's reach-door.ts). Every script on the page asks for
 * it here and gets the same one (@yaks/client `shared`), grown with the words
 * each brings. It says where its tab is (@yaks/notify/tab), which its door
 * says on to the Operator whose conversation the tab watches.
 *
 * A page the server drew from rows carries them (`drawnRows`), and the
 * graph starts holding them, shown until each subscription answers. It
 * keeps everything it holds in the browser's IndexedDB as it goes, one
 * database for each person (`pageDatabase`), within @yaks/client's bounds
 * (20,000 rows and 1 MB of answers) and under the epoch the server names
 * (`PAGE_EPOCH`), for a page drawn without its server to start from
 * (@yaks/client `wireDrawn`). A page the server drew never draws from that
 * copy: what it shows is newer, and the copy's answers would draw older
 * ones over it as if current. Opening a page again draws at once from the
 * kept picture of it instead (@yaks/web/picture), marked as kept. Off a page
 * (a test), its door is at `http://page`, which nothing is sent to until a
 * write or a watch asks.
 *
 * @module
 */
import {
  type Client,
  shared,
  wireDrawn,
  wireIdb,
  wireStash,
} from '@yaks/client'
import type { Bundle } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import { REACH, TAB_PERSON } from './names.ts'

export { REACH, TAB_PERSON }

/** The rows a page was drawn from, as the page carries them. */
export type Drawn = { person: string; epoch: string; rows: Bundle[] }

/** The epoch of what a page graph keeps: what the server says its kept rows
 * and answers are good for. A release that changes the shape of what a page
 * graph holds names another, and every browser's copy starts over. */
export let PAGE_EPOCH = 'page-1'

/** The IndexedDB database a person's page graph is kept in. */
export let pageDatabase = (person: string): string => `yaks-page:${person}`

/** Where a page carries the rows it was drawn from. */
export let DRAWN = 'script[data-page-graph]'

/** What a page carries of the rows `person`'s page was drawn from, as the
 * text of its `DRAWN` script: JSON with nothing that could close it. */
export let drawnRows = (person: string, rows: Bundle[]): string =>
  JSON.stringify({ person, epoch: PAGE_EPOCH, rows } as Drawn)
    .replaceAll('<', '\\u003c')

/** The rows a document or one of its views carries for `person`. */
export let drawn = (
  person: string,
  scope: Pick<Document, 'querySelector'> = globalThis.document,
): Drawn | undefined => {
  let said = scope?.querySelector(DRAWN)?.textContent
  let page = said ? JSON.parse(said) as Drawn : undefined
  return page?.person == person ? page : undefined
}

/** The tab's page graph, drawn for `person`, declaring at least `words`. */
export let pageGraph = (words: VocabDoc[], person: string): Client => {
  let start = drawn(person)
  let epoch = start?.epoch ?? PAGE_EPOCH
  let rows = start?.rows ?? []
  return shared(
    new URL(REACH, globalThis.location?.href ?? 'http://page').href,
    words,
    {
      vault: false,
      wireVault: globalThis.indexedDB
        ? wireDrawn(wireIdb({ name: pageDatabase(person) }), rows)
        : wireStash({ epoch, rows }),
      epoch,
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
