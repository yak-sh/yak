import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The private `_lens{package, step, ops}` vocabulary. */
export let docs: VocabDoc[] = [doc as VocabDoc]
/** This package's description, from its manifest. */
export let description: string = manifest.description
