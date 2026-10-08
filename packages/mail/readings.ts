// What other packages make of a letter that arrived. Mail records a letter: its
// envelope, its words, whom it is for and which letter it answers. Whether it
// also starts a conversation, answers a question or comments on a task is
// another package's to say, and only at the door, where the whole message
// (its headers included) is still in hand.
//
// A package says it through a `./mail` facet, the way an application offers
// @yaks/web its page through `./web`: `reading(options)` takes that package's
// own options from the config and returns a {@link Reading}. Both receiving
// doors, `POST /mail/inbound` (./routes.ts) and the pull (./service.ts), ask
// the configured packages for theirs, so a config that names none records
// letters and nothing else.

import { given, subpath, used } from '@yaks/cli/config'
import type { Plug } from '@yaks/host'
import type { Reading } from './arrive.ts'

/** A package's `./mail` facet: how it reads an arrival, given its options. */
export type MailFacet = {
  reading?: (options: Record<string, unknown>) => Reading | undefined
}

/** Every configured package's reading, in the order the config names them. */
export let readings = async (plugins: readonly Plug[] = []): Promise<
  Reading[]
> => {
  let out: Reading[] = []
  for (let plug of plugins) {
    let facet = await subpath<MailFacet>(used(plug), 'mail')
    let read = facet?.reading?.(given(plug))
    if (read) out.push(read)
  }
  return out
}
