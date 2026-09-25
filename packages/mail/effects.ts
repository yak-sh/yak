// What the server does about a letter: the `@yaks/mail/effects` entry point —
// the code behind `mail_post` (./vocab.json), which hands an outbound letter to
// a sender and writes `delivered` or `bounced` back onto it.
//
// The sender is why this entry point takes OPTIONS. Handing a letter over
// needs a transport — an account, a token, an endpoint — and none of that is a
// fact about the graph, so the config names it beside the plugin (./options.ts)
// and the factory builds it here.
//
// A server that names no sender gives it no code, so its runs are settled with
// nothing sent, which is exactly what a graph that only receives mail wants.
//
// A transport that is named but has not been given its credentials is a
// process that cannot send, and missing config never stops it from starting.
// Its handler sends nothing and leaves the letter owed; it says why once, and
// only when it meets a letter it could not send, so a command that never
// touches mail stays quiet. The letter is kept in the graph, not in the
// sender: `mail_post` declares a sweep over the letters still owed, so the
// first process that has the token sends them when it starts.

import type { Handler, Handlers } from '@yaks/effects'
import { then } from '@yaks/graph'
import type { Options, Transport } from './options.ts'
import type { Sender } from './send.ts'
import { letterOf, owed, sending } from './send.ts'
import { cloudflare } from './cloudflare.ts'
import { stash } from './stash.ts'

/** A named transport, built — or the reason there is none. A `via` nothing
 * here implements will never become a sender, and one whose credentials have
 * not arrived may yet: both are reported rather than thrown, and neither stops
 * the server from starting. */
export let post = (said: Transport): { sender?: Sender; waiting?: string } => {
  if (said.via == 'stash') return { sender: stash() }
  if (said.via == 'cloudflare') {
    return said.account && said.token ? { sender: cloudflare(said) } : {
      waiting:
        'waiting for credentials: a cloudflare sender needs `account` and `token`',
    }
  }
  return {
    waiting: `no sender called ${JSON.stringify((said as Transport).via)}`,
  }
}

/** The handler of a process that cannot send: it leaves every letter owed and
 * says why, once, the first time it meets one. */
export let waiting = (reason: string): Handler => {
  let said = false
  return (event, tx) =>
    then(letterOf(tx, event.entity), (letter) => {
      if (said || !owed(letter)) return
      said = true
      console.warn('@yaks/mail —', reason)
    })
}

/** The outbound half: `mail_post`, wherever a sender was named. Where the
 * sender cannot be built, nothing is sent and the letters wait in the graph
 * rather than the server refusing to start. */
export let effects = (_host: unknown, options: Options = {}): Handlers => {
  if (!options.sender) return {}
  let { sender, waiting: reason } = post(options.sender)
  return {
    mail_post: sender
      ? sending({
        sender,
        // Where the domain belongs to this graph, a letter to it never
        // reaches the transport at all — it is already where it is going.
        ...(options.local && options.domain ? { local: options.domain } : {}),
      })
      : waiting(reason!),
  }
}
