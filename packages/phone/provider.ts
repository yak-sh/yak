// Providers own their wire formats. Phone asks for a sender and normalized
// events; the host supplies modules, just as it supplies its other plugins.
import { ours, refusal, type Scheme } from '@yaks/hook'
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

/** Whether a provider takes webhooks: it says how they are signed and how to
 * read one. */
export let listens = (transport?: Provider): transport is Provider & {
  scheme: Scheme
  heard: (event: unknown) => Heard
} => !!transport?.scheme && !!transport.heard

/** A provider's webhook, read once its signature checks out under `key`.
 * Otherwise it is refused with why; `ours` marks a refusal that can mean the
 * key is wrong, which the door reports. */
export let verified = async (
  transport: Provider,
  key: string,
  request: Request,
): Promise<{ heard: Heard } | { refused: string; ours: boolean }> => {
  if (!listens(transport)) throw new Error('This provider takes no webhooks')
  let body = await request.text()
  let why = await refusal(transport.scheme, key, body, request.headers)
  return why
    ? { refused: why, ours: ours(why) }
    : { heard: transport.heard(JSON.parse(body)) }
}

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
