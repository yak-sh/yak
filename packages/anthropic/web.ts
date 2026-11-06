// The API's own web search and page fetch, which it runs between a reply's
// blocks. Each is used at most USES times a request and a fetched page is cut
// at FETCHED tokens, so what a request offering them may add is bounded
// (`HOSTED`). The API cuts no search's results, so SEARCHED is the most one is
// taken to read back.

import type { Hosted } from '@yaks/model'
import type { HostedParam } from './wire.ts'

let USES = 4
let FETCHED = 25_000
let SEARCHED = 15_000

/** What a request offering the web may add: its searches, and what they and
 * its fetches read back. */
export let HOSTED: Hosted = {
  searches: USES,
  input: USES * (SEARCHED + FETCHED),
}

// The models whose web tools filter what they read with code before it
// reaches the context; older ones have the plain versions.
let FILTERING = /^claude-(opus-(5|4-[678])|sonnet-(5|4-6))/

/** The web tools offered to a model. */
export let web = (model: string): HostedParam[] => {
  let [search, fetch] = FILTERING.test(model)
    ? ['20260209', '20260209']
    : ['20250305', '20250910']
  return [
    { type: `web_search_${search}`, name: 'web_search', max_uses: USES },
    {
      type: `web_fetch_${fetch}`,
      name: 'web_fetch',
      max_uses: USES,
      max_content_tokens: FETCHED,
      citations: { enabled: true },
    },
  ]
}
