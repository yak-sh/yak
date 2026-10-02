// Tracker declarations stay browser-safe; no sink, spool or storage imports.

export { computed } from './people.ts'
import { derived as people } from './people.ts'
import type { Derived } from '@yaks/sql'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import bug from './bug.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

export let bugDoc: VocabDoc = bug as VocabDoc
export let trackerDoc: VocabDoc = {
  ...doc,
  $defs: { ...doc.$defs, ...bug.$defs },
} as VocabDoc
export let derived = (): Derived => people
export let description: string = manifest.description
export let docs: VocabDoc[] = [trackerDoc]
