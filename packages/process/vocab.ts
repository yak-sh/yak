// The process components and nothing else, exported as `@yaks/process/vocab`
// for a caller that only needs to know the shape of the data. It imports no
// storage, no SQL and no runtime code, so a browser tab loading this
// vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { processDoc } from './comp.ts'

export { processDoc }

/** Every vocabulary document this plugin declares. */
export let docs: VocabDoc[] = [processDoc]
