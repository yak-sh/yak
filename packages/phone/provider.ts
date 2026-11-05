// Providers own their wire formats. Phone asks for a sender and normalized
// events; the host supplies modules, just as it supplies its other plugins.
import type { Scheme } from '@yaks/hook'
import type { Arrival, Outcome, Sender } from './text.ts'
import type { Transport } from './options.ts'
import type { Caller, Line, Ring } from './call.ts'

/** What a provider's webhook said: a text arrived or settled, a call rang,
 * or a call ended. */
export type Heard = {
  arrival?: Arrival
  outcome?: Outcome
  ring?: Ring
  ended?: { id: string }
}

export type Provider = {
  needs?: (keyof Transport)[]
  sender: (options: Transport) => Sender
  heard?: (event: unknown) => Heard
  scheme?: Scheme
  /** a provider that takes calls: its commands, and its audio stream */
  caller?: (options: Transport) => Caller
  line?: Line
}
export type Load = (via: string) => Promise<{ provider: Provider }>

export let provider: Load = (via) => import(`@yaks/${via}`)

/** A configured provider, with a texter's outbound provenance attached. */
export let sender = (options: Transport, transport: Provider): Sender => {
  let built = transport.sender(options)
  // A number the options name is the number it sends from; otherwise the
  // provider says, where it can.
  let from = options.number
  let own = from ? () => Promise.resolve(from) : built.from
  return {
    ...(own ? { from: own } : {}),
    send: async (text) => {
      let by = text.from ?? from
      let receipt = await built.send({ ...text, ...(by ? { from: by } : {}) })
      return {
        ...receipt,
        via: options.via,
        ...(receipt.from || by ? { from: receipt.from ?? by } : {}),
      }
    },
  }
}
