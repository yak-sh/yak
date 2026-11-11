// The words of an app's own people, without effects.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './package.json' with { type: 'json' }

/** The individual, household and relation declarations. */
export let peopleDoc: VocabDoc = doc as VocabDoc

/** The package description from its manifest. */
export let description: string = manifest.description

/** Every vocabulary document this package declares. */
export let docs: VocabDoc[] = [peopleDoc]
