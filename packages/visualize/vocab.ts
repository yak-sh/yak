// Value-free platform anatomy and bounded process-local activity, not rows.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The agent doors into the same snapshots the standalone page reads. */
export let visualizeDoc: VocabDoc = doc

/** The manifest is the one place this package's description is written. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [visualizeDoc]
