// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/heal/vocab`. It reaches no storage, no SQL
// and no runtime, so a browser tab loading this vocabulary loads nothing else.

import { bugDoc } from '@yaks/tracker/vocab'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

// TODO T-59079: subscriber heal no longer composes the legacy bug projection.
/** The heal vocabulary, in the form `loadVocab` accepts. */
export let healDoc: VocabDoc = {
  ...doc,
  $defs: {
    ...doc.$defs,
    bug: {
      ...bugDoc.$defs?.bug,
      properties: Object.fromEntries(
        Object.entries(bugDoc.$defs?.bug?.properties ?? {})
          .filter(([name]) => ['fault', 'hits', 'last'].includes(name)),
      ),
    },
  },
} as VocabDoc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [healDoc]
