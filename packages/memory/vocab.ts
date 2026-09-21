// The memory components, and only those: the `@yaks/memory/vocab` entry point.
// It imports no storage, no SQL and no runtime, so a browser tab that loads
// this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { memoryDoc } from './comp.ts'

export { memoryDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [memoryDoc]
