// The write-time half: the `@yaks/mail/graph` entry point — the components
// and, where the config names a domain, the canonicalizer that normalizes an
// address on the way in.
//
// The domain is this plugin's option rather than a server-wide setting: which
// domain an address belongs to is a fact about this plugin, and a server that
// composes two mailboxes would otherwise have one domain between them.
//
// The outbound half is `./effects`, which needs the sender the config names.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { mailbox } from './plugin.ts'
import { recipients } from './recipient.ts'
import type { Options } from './options.ts'

/** The letter components, the address canonicalizer the domain implies, and
 * the mark that keeps an address only a letter names with the letters, where
 * the store speaks the words it is written in. */
export let plugins = (
  { vocab }: { vocab: Vocab },
  options: Options = {},
): Plugin[] => [
  mailbox({ domain: options.domain }),
  ...['email', 'deliver', 'recipient'].every((n) =>
      vocab.comp(n)?.package == '@yaks/mail'
    )
    ? [recipients()]
    : [],
]
