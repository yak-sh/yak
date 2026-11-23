// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/domains/vocab`. It reaches no storage and no
// runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './package.json' with { type: 'json' }

/** The domains vocabulary: `domain_order{name, space, serves, checkout,
 * cents, live}`, its marks `domain_registered{at, expires}`,
 * `domain_refused{at, why}` and `domain_refunded{at, refund}`, and the
 * effects `register_domain` and `renew_domains`. */
export let domainsDoc: VocabDoc = doc as VocabDoc

/** What this package is: its manifest's description. */
export let description: string = manifest.description

/** Every document this package declares. */
export let docs: VocabDoc[] = [domainsDoc]
