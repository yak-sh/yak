// The REPL's words, and nothing else: what a store keeping REPLs and their
// cells imports at `@yaks/code-mode/vocab`.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './package.json' with { type: 'json' }

/** The code mode vocabulary, in the form `loadVocab` accepts. */
export let codeModeDoc: VocabDoc = doc as VocabDoc

/** What this package is: its manifest's description. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [codeModeDoc]
