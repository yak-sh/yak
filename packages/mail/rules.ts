// What a batch MEANS about a letter: the `rules` facet a host takes
// (`@yaks/mail/rules`) — the vocabulary and, where the host names a domain,
// the canonicalizer that fixes an address on the way in.
//
// The OUTBOUND half is not here. Handing a letter to a sender is an effect,
// and an effect needs a configured sender (an SMTP host, a Cloudflare binding)
// that a graph config does not carry; a host that sends composes
// {@link mailbox} itself with its own. This facet is what a graph that
// RECEIVES mail needs, which is the whole of what a plugin can say alone.

import type { Plugin } from '@yaks/graph'
import { mailbox } from './plugin.ts'

/** The letter words, and the address canonicalizer the host's domain implies. */
export let rules = (host: { config: { domain?: string } }): Plugin[] => [
  mailbox({ domain: host.config.domain }),
]
