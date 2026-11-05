// Providers own their wire formats. Phone asks for a sender and normalized
// events; the host supplies modules, just as it supplies its other plugins.
import type { Scheme } from '@yaks/hook'
import type { Arrival, Outcome, Sender } from './text.ts'
import type { Transport } from './options.ts'

export type Provider = {
  needs?: (keyof Transport)[]
  sender: (options: Transport) => Sender
  heard?: (event: unknown) => { arrival?: Arrival; outcome?: Outcome }
  scheme?: Scheme
}
export type Load = (via: string) => Promise<{ provider: Provider }>

export let provider: Load = (via) => import(`@yaks/${via}`)

/** A configured provider, with a texter's outbound provenance attached. */
export let sender = (options: Transport, transport: Provider): Sender => {
  let built = transport.sender(options)
  return {
    send: async (text) => {
      let from = text.from ?? options.number
      let receipt = await built.send({ ...text, ...(from ? { from } : {}) })
      return {
        ...receipt,
        via: options.via,
        ...(receipt.from || from ? { from: receipt.from ?? from } : {}),
      }
    },
  }
}
