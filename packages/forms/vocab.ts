// Form declarations shared by graphs and their consumers, without effects.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './package.json' with { type: 'json' }

/** Form, question, registration and waitlist declarations. */
export let formsDoc: VocabDoc = doc as VocabDoc

/** The package description from its manifest. */
export let description: string = manifest.description

/** Every vocabulary document this package declares. */
export let docs: VocabDoc[] = [formsDoc]
