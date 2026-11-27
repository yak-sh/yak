// The directory's trash declarations.
import type { VocabDoc } from '@yaks/vocab'
import trashJson from './vocab/trash.vocab.json' with { type: 'json' }
export let docs: VocabDoc[] = [trashJson as VocabDoc]
