// Tracker declarations stay browser-safe; no sink, spool or storage imports.

export { computed } from './people.ts'
import { derived as people } from './people.ts'
import type { Derived } from '@yaks/sql'
import { pick, type VocabDoc } from '@yaks/vocab/runtime'
import doc from './vocab.json' with { type: 'json' }
import manifest from './package.json' with { type: 'json' }

export let trackerDoc: VocabDoc = doc as VocabDoc
export let bugDoc: VocabDoc = pick(trackerDoc, ['bug'], 'tracker-bug')
export let derived = (): Derived => people
export let description: string = manifest.description
export let docs: VocabDoc[] = [trackerDoc]
