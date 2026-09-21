// The component definitions and nothing else, exported as
// `@yaks/member/vocab`. It imports no storage, no SQL and no runtime code, so a
// browser tab that loads this vocabulary loads nothing else with it.

import type { VocabDoc } from '@yaks/vocab'
import { memberDoc } from './comp.ts'

export { memberDoc }

/** Every vocabulary document this plugin contributes. */
export let docs: VocabDoc[] = [memberDoc]
