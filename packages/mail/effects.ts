// What a host DOES about a letter: the `effects` facet (`@yaks/mail/effects`)
// — one `created(mail)` watch that hands an outbound letter to a sender and
// settles `delivered` or `bounced` back onto it.
//
// The sender is the reason this facet takes OPTIONS. Handing a letter over
// needs a transport — an account, a token, an endpoint — and none of that is a
// fact about the graph, so the config names it beside the plugin (./options.ts)
// and the factory builds it here.
//
// A host that names no sender gets no watch, which is exactly what a graph
// that only RECEIVES mail wants — not a letter sitting outbound forever
// against a transport nobody configured.
//
// A transport NAMED and not yet given its credentials is the same thing said
// differently: missing config never prevents boot, so the watch is not taken,
// the reason is said once, and `mail check` keeps answering it. A letter
// written meanwhile sits outbound and goes as soon as a host with the token
// composes — the graph is where it is kept, not the sender.

import type { Watch } from '@yaks/effects'
import { MAIL } from './comp.ts'
import type { Options, Transport } from './options.ts'
import type { Sender } from './send.ts'
import { sending } from './send.ts'
import { cloudflare } from './cloudflare.ts'
import { stash } from './stash.ts'

/** A named transport, built — or the sentence saying why there is none. A
 * `via` nothing here implements will never become a sender, and one whose
 * credentials have not arrived may yet: both are said rather than thrown, and
 * neither takes the host down. */
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

/** The outbound half: `created(mail)`, where a sender was named AND can be
 * built. Where it cannot, nothing is sent and the reason is said once — the
 * letters wait in the graph rather than the host refusing to come up. */
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
      // Where the domain is the graph's own namespace, a letter to it never
      // reaches the transport at all — it is already where it is going.
      ...(options.local && options.domain ? { local: options.domain } : {}),
    }),
    doc: 'hand an outbound letter to the sender and settle its outcome',
  }]
}
