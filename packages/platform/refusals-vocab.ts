// The directory's refusal report declaration (refusals.ts): what its hourly
// wake owes.
import type { VocabDoc } from '@yaks/vocab'
import refusalsJson from './vocab/refusals.vocab.json' with { type: 'json' }
export let docs: VocabDoc[] = [refusalsJson as VocabDoc]
