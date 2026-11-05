// The host wires adapters and lends secrets. No provider's wire format crosses
// this boundary; app stores and Operator channels use the same texter.
import { provider as telnyx } from '@yaks/telnyx'
import { provider as voipms } from '@yaks/voipms'
import { provider as pinnacle } from '@yaks/pinnacle'
import { type Provider, type Sender, sender, type Transport } from '@yaks/phone'
import type { Env } from './env.ts'

export let PROVIDERS: Record<string, Provider> = { telnyx, voipms, pinnacle }

export let signingKey = (env: Env, via: string): string | undefined =>
  ({ telnyx: env.TELNYX_PUBLIC_KEY, pinnacle: env.PINNACLE_SIGNING_SECRET })[
    via
  ]

let keys = (env: Env): Record<string, string | undefined> => ({
  telnyx: env.TELNYX_API_KEY,
  pinnacle: env.PINNACLE_API_KEY,
  voipms: env.VOIPMS_API_PASSWORD,
})

export let settings = (env: Env, chosen?: Transport): Transport => {
  let base = env.PHONE_SENDER ?? { via: 'telnyx' }
  let via = chosen?.via ?? base.via
  let defaults: Record<string, Partial<Transport>> = {
    telnyx: { profile: 'yaks.app', tollFree: true, api: env.TELNYX_API },
    pinnacle: { number: env.PINNACLE_NUMBER, api: env.PINNACLE_API },
    voipms: { user: env.VOIPMS_USERNAME, number: env.VOIPMS_NUMBER },
  }
  return {
    via,
    ...defaults[via],
    ...base.via == via ? base : {},
    ...chosen,
    key: keys(env)[via],
  }
}

let senders = new Map<string, Sender>()

/** The platform's selection, or a space's override, read on every send. */
export let texter = (env: Env, chosen?: Transport): Sender => {
  let options = settings(env, chosen)
  let provider = PROVIDERS[options.via]
  if (!provider) throw new Error(`No phone provider ${options.via}`)
  let key = JSON.stringify(options)
  let built = senders.get(key)
  if (!built) senders.set(key, built = sender(options, provider))
  return built
}
