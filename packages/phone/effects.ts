// The texter is lent at the effect boundary, selected by sender.via: by the
// host, or by a provider plugin beside this one (./plugin.ts).
import type { Handlers } from '@yaks/effects'
import type { Host } from '@yaks/host'
import type { Options } from './options.ts'
import { sending } from './send.ts'
import { type Stash, stash } from './stash.ts'

export let effects = (
  host?: Pick<Host, 'texters'> | null,
  options: Options = {},
): Handlers => {
  let kept: Stash | undefined
  return {
    text_post: async (event, tx, write, attempt) => {
      let via = options.sender?.via
      let texter = via == 'stash'
        ? kept ??= stash()
        : via
        ? host?.texters?.[via]
        : undefined
      let reason = !via
        ? 'waiting for a configured sender'
        : !texter
        ? `waiting for a texter: nothing lends ${via}`
        : texter.waiting?.()
      if (!reason) {
        return sending({ sender: texter! })(event, tx, write, attempt)
      }
      await write([{ entity: event.entity, deliver: { waiting: reason } }])
      if (attempt?.defer) return attempt.defer(60_000)
      throw new Error(`@yaks/phone — ${reason}`)
    },
  }
}
