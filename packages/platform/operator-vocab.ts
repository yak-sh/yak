import type { VocabDoc } from '@yaks/vocab'
import operatorJson from './vocab/operator.vocab.json' with { type: 'json' }

export let operatorDoc: VocabDoc = operatorJson as VocabDoc

/** The `yak/operator` vocab facet: the Operator store's own words. */
export let docs: VocabDoc[] = [operatorDoc]
