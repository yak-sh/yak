// The persona component declarations alone, exported as
// `@yaks/persona/vocab`. Nothing here touches storage, SQL or any runtime API,
// so a browser tab that only needs these components loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { personaDoc } from './comp.ts'

export { personaDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [personaDoc]
