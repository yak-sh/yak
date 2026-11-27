// The directory's deployment work; commit is declared by @yaks/git.
import type { VocabDoc } from '@yaks/vocab'
import doc from './git.vocab.json' with { type: 'json' }
export let docs: VocabDoc[] = [doc]
