// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/alias/vocab`. It reaches no storage, no SQL
// and no runtime, so a browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/**
 * The alias vocabulary, to load beside @yaks/key's and your own:
 * `loadVocab([keyDoc, aliasDoc, ...mine], [keyKeywords])`. It declares nothing
 * about what the named entity is — that is your own document's job — only that
 * a name is a kind of key.
 */
export let aliasDoc: VocabDoc = doc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [aliasDoc]
