// The component definition and nothing else, exported as
// `@yaks/secrets/vocab`. It imports no storage and no runtime, so a browser tab
// that loads this vocabulary loads nothing else with it.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The `secret` component. */
export let secretsDoc: VocabDoc = doc

/** Every vocabulary document this plugin contributes. */
export let docs: VocabDoc[] = [secretsDoc]
