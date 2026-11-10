// The trial component, and only it: the `@yaks/trial/vocab` entry point. It
// reaches no storage and no runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './package.json' with { type: 'json' }

/** The trial vocabulary: `trial{case, variant, asked, unasked, tokens}`. */
export let trialDoc: VocabDoc = doc as VocabDoc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this package declares. */
export let docs: VocabDoc[] = [trialDoc]
