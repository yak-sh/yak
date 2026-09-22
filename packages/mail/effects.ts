// What the server does about a letter: the `@yaks/mail/effects` entry point —
// one `created(mail)` handler that hands an outbound letter to a sender and
// writes `delivered` or `bounced` back onto it.
//
// The sender is why this entry point takes OPTIONS. Handing a letter over
// needs a transport — an account, a token, an endpoint — and none of that is a
// fact about the graph, so the config names it beside the plugin (./options.ts)
// and the factory builds it here.
//
// A server that names no sender registers no handler, which is exactly what a
// graph that only receives mail wants — not a letter sitting outbound forever
// against a transport nobody configured.
//
// A transport that is named but has not been given its credentials amounts to
// the same thing: missing config never stops the server from starting, so the
// handler is not registered, the reason is logged once, and `mail check` keeps
// reporting it. A letter written meanwhile stays outbound and is sent as soon
// as a server that has the token loads the package — the letter is kept in the
// graph, not in the sender.

import type { Watch } from '@yaks/effects'
import { MAIL } from './comp.ts'
import type { Options, Transport } from './options.ts'
import type { Sender } from './send.ts'
import { sending } from './send.ts'
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

/** The outbound half: a `created(mail)` handler, where a sender was named AND
 * can be built. Where it cannot, nothing is sent and the reason is logged once
 * — the letters wait in the graph rather than the server refusing to start. */
export let effects = (_host: unknown, options: Options = {}): Watch[] => {
  if (!options.sender) return []
  let { sender, waiting } = post(options.sender)
  if (!sender) {
    console.warn('@yaks/mail —', waiting)
    return []
  }
  return [{
    comp: MAIL,
    created: sending({
      sender,
      // Where the domain belongs to this graph, a letter to it never reaches
      // the transport at all — it is already where it is going.
      ...(options.local && options.domain ? { local: options.domain } : {}),
    }),
    doc: 'hand an outbound letter to the sender and record its outcome',
  }]
}
