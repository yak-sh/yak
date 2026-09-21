// The portfolio's component declarations and nothing else, exported as
// `@yaks/project/vocab`. It imports no storage, no SQL and no runtime API, so a
// browser tab loading this vocabulary loads nothing else with it.

import type { VocabDoc } from '@yaks/vocab'
import { projectDoc } from './comp.ts'

export { projectDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [projectDoc]
