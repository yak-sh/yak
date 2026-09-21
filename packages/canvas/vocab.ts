// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/canvas/vocab`. It reaches no storage, no SQL
// and no runtime, so a browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { canvasDoc } from './comp.ts'

export { canvasDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [canvasDoc]
