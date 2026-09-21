// The component definition and nothing else, exported as `@yaks/page/vocab`.
// It imports no storage, no SQL and no runtime code, so a browser tab that
// loads this vocabulary loads nothing else with it.

import type { VocabDoc } from '@yaks/vocab'
import { pageDoc } from './comp.ts'

export { pageDoc }

/** Every vocabulary document this plugin contributes. */
export let docs: VocabDoc[] = [pageDoc]
