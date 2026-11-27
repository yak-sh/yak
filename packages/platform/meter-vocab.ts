// The directory's meter declarations.
import type { VocabDoc } from '@yaks/vocab'
import meterJson from './vocab/meter.vocab.json' with { type: 'json' }
export let docs: VocabDoc[] = [meterJson as VocabDoc]
