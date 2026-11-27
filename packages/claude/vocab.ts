import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
export let claudeDoc: VocabDoc = doc
export let docs: VocabDoc[] = [claudeDoc]
