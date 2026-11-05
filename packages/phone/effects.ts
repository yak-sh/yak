// The `@yaks/phone/effects` facet: the code behind `text_post`, with the
// sender the config names (./options.ts): a texter the host lends under that
// name, or one built here, read on every attempt so a key written after start
// is used without a restart.

import type { Handlers } from '@yaks/effects'
import type { Host } from '@yaks/host'
import type { Options, Transport } from './options.ts'
import { sending } from './send.ts'
import { type Stash, stash } from './stash.ts'
import { telnyx } from './telnyx.ts'
import type { Sender } from './text.ts'
import { voipms } from './voipms.ts'

// What each sender needs said before it can send.
let NEEDS: Record<string, string> = {
  telnyx: 'a telnyx sender needs `key` and `profile`',
  voipms: 'a voipms sender needs `user` and `key`',
}

/** `text_post`, through the sender the config names. With none, or a
 * Telnyx sender missing its key or profile or a voip.ms one its user or key,
 * a text waits in the graph with the reason and is tried again a minute
 * later. */
export let effects = (
  host?: Pick<Host, 'texters'> | null,
  options: Options = {},
): Handlers => {
  let kept: Stash | undefined
  let built = (said?: Transport): Sender | null => {
    if (!said) return null
    if (host?.texters && Object.hasOwn(host.texters, said.via)) {
      return host.texters[said.via]
    }
    return said.via == 'stash'
      ? kept ??= stash()
      : said.via == 'telnyx' && said.key && said.profile
      ? telnyx({ key: said.key, profile: said.profile, api: said.api })
      : said.via == 'voipms' && said.user && said.key
      ? voipms({
        user: said.user,
        key: said.key,
        number: said.number,
        api: said.api,
      })
      : null
  }
  return {
    text_post: async (event, tx, write, attempt) => {
      let said = options.sender
      let sender = built(said)
      if (sender) return sending({ sender })(event, tx, write, attempt)
      let reason = !said
        ? 'waiting for a configured sender'
        : NEEDS[said.via]
        ? `waiting for credentials: ${NEEDS[said.via]}`
        : `no sender called ${JSON.stringify(said.via)}`
      await write([{ entity: event.entity, deliver: { waiting: reason } }])
      if (attempt?.defer) return attempt.defer(60_000)
      throw new Error(`@yaks/phone — ${reason}`)
    },
  }
}
