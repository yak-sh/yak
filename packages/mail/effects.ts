// What the server does about a letter: the `@yaks/mail/effects` entry point —
// the code behind `mail_post` (./vocab.json), which hands an outbound letter to
// a sender and writes `delivered` or `bounced` back onto it.
//
// The sender is why this entry point takes OPTIONS. Handing a letter over
// needs a transport — an account, a token, an endpoint — and none of that is a
// fact about the graph, so the config names it beside the plugin (./options.ts)
// and the factory builds it here.
//
// An outbound request must never settle silently. A missing sender leaves a
// visible waiting reason without marking the letter tried, and throws through
// the effect pool's reporting door. The startup sweep can still recover it.
// Read transport options on every attempt: secrets can arrive after startup.

import type { Handler, Handlers } from '@yaks/effects'
import { after } from '@yaks/fp'
import type { Host } from '@yaks/host'
import type { Options, Transport } from './options.ts'
import type { Sender } from './send.ts'
import { letterOf, owed, sending } from './send.ts'
import { cloudflare } from './cloudflare.ts'
import { stash } from './stash.ts'

/** A named sender, lent by the host or built here — or the reason there is
 * none. An unavailable sender leaves letters waiting without stopping boot. */
export let post = (
  said: Transport,
  host?: Pick<Host, 'senders'> | null,
): { sender?: Sender; waiting?: string } => {
  if (host?.senders && Object.hasOwn(host.senders, said.via)) {
    return { sender: host.senders[said.via] }
  }
  if (said.via == 'stash') return { sender: stash() }
  if (said.via == 'cloudflare') {
    return said.account && said.token
      ? {
        sender: cloudflare({
          ...said,
          account: said.account,
          token: said.token,
        }),
      }
      : {
        waiting:
          'waiting for credentials: a cloudflare sender needs `account` and `token`',
      }
  }
  return {
    waiting: `no sender called ${JSON.stringify(said.via)}`,
  }
}

/** Leave unsent letters recoverable, but make the failure visible to both the
 * owner and the host's effect reporter, which forwards reports to the tracker. */
export let waiting = (reason: string): Handler => (event, tx, write) =>
  after(letterOf(tx, event.entity), async (letter) => {
    if (!owed(letter)) return
    await write([{ entity: event.entity, deliver: { waiting: reason } }])
    throw new Error(`@yaks/mail — ${reason}`)
  })

/** The outbound half: `mail_post`, wherever a sender was named. Where the
 * sender cannot be built, nothing is sent and the letters wait in the graph
 * rather than the server refusing to start. */
export let effects = (
  host?: Pick<Host, 'senders'> | null,
  options: Options = {},
): Handlers => {
  let kept: Sender | undefined
  return {
    mail_post: (event, tx, write, attempt) => {
      let said = options.sender
      let { sender, waiting: reason } = said
        ? post(said, host)
        : { waiting: 'waiting for a configured sender' }
      // A built-in stash keeps its receipts across attempts. A host's sender
      // is already constructed and owns its own lifetime.
      if (
        sender && said?.via == 'stash' &&
        !Object.hasOwn(host?.senders ?? {}, said.via)
      ) sender = kept ??= sender
      let run = sender
        ? sending({
          sender,
          // Local addresses are already where they are going.
          ...(options.local && options.domain ? { local: options.domain } : {}),
        })
        : waiting(reason!)
      return run(event, tx, write, attempt)
    },
  }
}
