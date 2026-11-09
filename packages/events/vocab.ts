// Event declarations, shared without storage or platform dependencies.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './package.json' with { type: 'json' }

/** Calendar event declarations. */
export let eventsDoc: VocabDoc = doc

/** The package description from its manifest. */
export let description: string = manifest.description

/** Every vocabulary document this package declares. */
export let docs: VocabDoc[] = [eventsDoc]
