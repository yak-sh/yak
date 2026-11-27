// The directory's calendar job tag, shared by its store words.
import type { VocabDoc } from '@yaks/vocab'
import mcpRetirementJson from './vocab/mcp-retirement.vocab.json' with {
  type: 'json',
}
import sweepJson from './vocab/sweep.vocab.json' with { type: 'json' }
export let mcpRetirementDoc: VocabDoc = mcpRetirementJson as VocabDoc

export let sweepDoc: VocabDoc = sweepJson as VocabDoc
