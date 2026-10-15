/** Page-only controls state. Consumers compose it into their page's vocabulary. */
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }
export let docs: VocabDoc[] = [doc as VocabDoc]
export let description: string = manifest.description
