// The provider is loaded at the effect boundary, selected by sender.via.
import type { Handlers } from '@yaks/effects'
import type { Host } from '@yaks/host'
import type { Options } from './options.ts'
import { type Load, provider, sender } from './provider.ts'
import { sending } from './send.ts'
import { type Stash, stash } from './stash.ts'

export let effects = (
  host?: Pick<Host, 'texters'> | null,
  options: Options = {},
  load: Load = provider,
): Handlers => {
  let kept: Stash | undefined
  return {
    text_post: async (event, tx, write, attempt) => {
      let said = options.sender
      let reason = 'waiting for a configured sender'
      if (said) {
        let lent = host?.texters?.[said.via]
        if (lent) return sending({ sender: lent })(event, tx, write, attempt)
        if (said.via == 'stash') {
          return sending({ sender: kept ??= stash() })(
            event,
            tx,
            write,
            attempt,
          )
        }
        let transport = (await load(said.via)).provider
        let missing = transport.needs?.filter((key) => !said[key]) ?? []
        if (!missing.length) {
          return sending({ sender: sender(said, transport) })(
            event,
            tx,
            write,
            attempt,
          )
        }
        reason = `waiting for credentials: a ${said.via} sender needs ${
          missing.join(', ')
        }`
      }
      await write([{ entity: event.entity, deliver: { waiting: reason } }])
      if (attempt?.defer) return attempt.defer(60_000)
      throw new Error(`@yaks/phone — ${reason}`)
    },
  }
}
