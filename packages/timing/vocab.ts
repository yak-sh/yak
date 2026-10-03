/** Timing and trace declarations for tracker stores and browser readers.
 * The facet contains data only and imports no runtime or delivery code. */
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The timing minute and selected trace vocabulary. */
export let timingDoc: VocabDoc = doc as VocabDoc
/** The package description from its manifest. */
export let description: string = manifest.description
/** Every vocabulary document this package declares. */
export let docs: VocabDoc[] = [timingDoc]
