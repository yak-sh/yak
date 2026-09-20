// What a batch MEANS about a name: the `rules` facet a host takes
// (`@yaks/alias/rules`). A name is a key, so this rule is @yaks/key's kind
// machinery pointed at the `alias` component.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { aliases } from './plugin.ts'

/** Names lifted into keys, and references resolved through them. */
export let rules = (host: { vocab: Vocab }): Plugin[] => [aliases(host.vocab)]
