// Machine declarations, importable without a runtime or storage.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The machine vocabulary. */
export let machineDoc: VocabDoc = doc as VocabDoc
/** The package's description, from its manifest. */
export let description: string = manifest.description
/** Every vocabulary document this package declares. */
export let docs: VocabDoc[] = [machineDoc]
