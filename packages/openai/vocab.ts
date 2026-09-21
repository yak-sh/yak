// The component declaration, and nothing else: the module a server or a browser
// page imports at `@yaks/openai/vocab`. It reaches no storage, no SQL and no
// runtime, so a browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { openaiDoc } from './responses.ts'

export { openaiDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [openaiDoc]
