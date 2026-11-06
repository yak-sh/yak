// Stripe's webhook doors, as @yaks/host's `Door`s: `webhook`, the endpoint
// on the platform's own account, which hears about its subscriptions
// (./plans.ts `changed`), and `connect`, the Connect endpoint, which hears
// about its sellers' accounts (./shops.ts `shopped`). Stripe delivers the two
// to endpoints of their own, each signed with its own `whsec_…`, so each door
// verifies with its own secret, and one verified with the other's hears
// nothing.
//
// The body is read as text once and verified as that exact string: the
// signature covers the raw bytes, so parsing and re-serializing would verify
// something Stripe never signed. A body signed with our secret that is not
// JSON throws, since only our own secret could have signed it.
import type { Door, Heard } from '@yaks/host/payments'
import { ours, refusal } from '@yaks/hook'
import { changed, type Options as Priced } from './plans.ts'
import { shopped } from './shops.ts'

/** What a config gives the provider: the plans' key, clock and prices, and
 * each door's signing secret by its name. A door with none hears nothing. */
export type Options = Priced & {
  doors?: { webhook?: string; connect?: string }
}

let door = (
  secret: () => string | undefined,
  read: (event: unknown) => Heard,
  options: Options,
): Door =>
async (request) => {
  let key = secret()
  if (!key) return undefined
  let raw = await request.text()
  let why = await refusal(
    'stripe',
    key,
    raw,
    request.headers,
    options.clock?.now(),
  )
  return why
    ? { refused: why, ours: ours(why) }
    : { heard: read(JSON.parse(raw)) }
}

/** Stripe's doors, each secret read from `options` as a request arrives. */
export let doors = (options: Options): Record<string, Door> => ({
  webhook: door(() => options.doors?.webhook, changed(options), options),
  connect: door(() => options.doors?.connect, shopped(options), options),
})
