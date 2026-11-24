/**
 * A signed-in tab's one page graph (D-475): a @yaks/client over the page
 * graph's door, which reads, writes and watches across every store the
 * person reaches (yaks.app's reach-door.ts). Every script on the page asks for
 * it here and gets the same one (@yaks/client `shared`), grown with the words
 * each brings. It holds nothing on disk yet. Off a page (a test), its door is
 * at `http://page`, which nothing is sent to until a write or a watch asks.
 *
 * @module
 */
import { type Client, shared } from '@yaks/client'
import type { VocabDoc } from '@yaks/vocab'

/** The page graph's door: `/query`, `/apply` and `/ws` under it. No space
 * can be named `account` (./names.ts), so it is no space's page. */
export let REACH = '/manage/account/reach'

/** The header a tab's writes say whom it was drawn for: a tab drawn for one
 * person writes nothing once the browser is signed in as another. */
export let TAB_PERSON = 'x-yak-tab-person'

/** The tab's page graph, drawn for `person`, declaring at least `words`. */
export let pageGraph = (words: VocabDoc[], person: string): Client =>
  shared(
    new URL(REACH, globalThis.location?.href ?? 'http://page').href,
    words,
    {
      vault: false,
      wireVault: false,
      page: false,
      headers: { [TAB_PERSON]: person },
      outboxScope: `${REACH}:${person}`,
    },
  )
