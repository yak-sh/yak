// Providers own their wire formats. Phone asks for a sender and normalized
// events; a provider package gives its `Provider` as data, and a plugin built
// from it (./plugin.ts) lends it under its own name.
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

/** A number an account holds, as its provider keeps its texting. */
export type Held = {
  /** in E.164 form */
  number: string
  /** whether it sends and receives texts */
  sms: boolean
  /** the URL its texts are sent to, when its callback is on */
  callback?: string
}

/** A person's own account at a provider: a {@link Sender}, the numbers it
 * holds, and `point`, which sends a number's texts to a URL and leaves
 * every other way they reach the person as it was. */
export type Account = Sender & {
  lines: () => Promise<Held[]>
  point: (number: string, url: string) => Promise<void>
}

/** How a person connects a number of their own through a provider: their
 * account, and the callback its texts reach a host by. */
export type Own = {
  /** the field of the person's connection each setting is read from */
  fields: Partial<Record<keyof Transport, string>>
  /** their account, opened with those settings */
  account: (options: Transport) => Account
  /** the query a callback URL asks the provider to fill in, appended to
   * the host's own address */
  callback: string
  /** what a callback said, from its query, once the host has found its own
   * secret in the URL; null when it names no text */
  called: (query: URLSearchParams, at?: string) => Arrival | null
  /** what a person is told, in the provider's words, when their settings
   * open no account and when none of its numbers texts */
  said: { unopened: string; untexting: string }
}

export type Provider = {
  needs?: (keyof Transport)[]
  sender: (options: Transport) => Sender
  heard?: (event: unknown) => Heard
  scheme?: Scheme
  /** a provider that takes calls: its commands, and its audio stream */
  caller?: (options: Transport) => Caller
  line?: Line
  /** a provider a person connects their own number through */
  own?: Own
}
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
