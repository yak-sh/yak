// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/alias/vocab`. It reaches no storage, no SQL
// and no runtime, so a browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { aliasDoc } from './comp.ts'

export { aliasDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [aliasDoc]
