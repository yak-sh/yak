// The `@yaks/phone/effects` facet: the code behind `text_post`, with the
// sender the config names (./options.ts), read on every attempt so a key
// written after start is used without a restart.

import type { Handlers } from '@yaks/effects'
import type { Options } from './options.ts'
import { sending } from './send.ts'
import { type Stash, stash } from './stash.ts'
import { telnyx } from './telnyx.ts'

/** `text_post`, through the sender the config names. With none, or a
 * Telnyx sender missing its key or profile, a text waits in the graph with
 * the reason and is tried again a minute later. */
export let effects = (_host?: unknown, options: Options = {}): Handlers => {
  let kept: Stash | undefined
  return {
    text_post: async (event, tx, write, attempt) => {
      let said = options.sender
      let sender = said?.via == 'stash'
        ? kept ??= stash()
        : said?.via == 'telnyx' && said.key && said.profile
        ? telnyx({ key: said.key, profile: said.profile, api: said.api })
        : null
      if (sender) return sending({ sender })(event, tx, write, attempt)
      let reason = said
        ? 'waiting for credentials: a telnyx sender needs `key` and `profile`'
        : 'waiting for a configured sender'
      await write([{ entity: event.entity, deliver: { waiting: reason } }])
      if (attempt?.defer) return attempt.defer(60_000)
      throw new Error(`@yaks/phone — ${reason}`)
    },
  }
}
