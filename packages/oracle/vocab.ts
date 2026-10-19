// Oracle vocabulary shared by graph hosts and browser renderers.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }
export let oracleDoc: VocabDoc = doc
export let docs: VocabDoc[] = [oracleDoc]
export let description: string = manifest.description
