// Tracker declarations stay browser-safe; no sink, spool or storage imports.

export { computed, derived } from './people.ts'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import bug from './bug.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

export let bugDoc: VocabDoc = bug as VocabDoc
export let trackerDoc: VocabDoc = {
  ...doc,
  $defs: { ...doc.$defs, ...bug.$defs },
} as VocabDoc
export let description: string = manifest.description
export let docs: VocabDoc[] = [trackerDoc]
