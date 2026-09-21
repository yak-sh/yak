// The write-time half: the `@yaks/mail/rules` entry point — the components
// and, where the config names a domain, the canonicalizer that normalizes an
// address on the way in.
//
// The domain is this plugin's OPTION rather than a server-wide setting: which
// domain an address belongs to is a fact about this plugin, and a server that
// composes two mailboxes would otherwise have one domain between them.
//
// The outbound half is `./effects`, which needs the sender the config names.

import type { Plugin } from '@yaks/graph'
import { mailbox } from './plugin.ts'
import type { Options } from './options.ts'

/** The letter components, and the address canonicalizer the domain implies. */
export let rules = (_host: unknown, options: Options = {}): Plugin[] => [
  mailbox({ domain: options.domain }),
]
