// What a batch MEANS about a letter: the `rules` facet a host takes
// (`@yaks/mail/rules`) — the vocabulary and, where the config names a domain,
// the canonicalizer that fixes an address on the way in.
//
// The domain is this plugin's OPTION rather than the host's config: whose
// namespace an address belongs to is a fact about this plugin, and a host that
// composes two mailboxes would otherwise have one domain between them.
//
// The outbound half is `./effects`, which needs a sender the config names.

import type { Plugin } from '@yaks/graph'
import { mailbox } from './plugin.ts'
import type { Options } from './effects.ts'

/** The letter words, and the address canonicalizer the domain implies. */
export let rules = (_host: unknown, options: Options = {}): Plugin[] => [
  mailbox({ domain: options.domain }),
]
