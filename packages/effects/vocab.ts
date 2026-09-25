// The component declarations, and only those: the module exported as
// `@yaks/effects/vocab`. It imports no storage, no SQL and no runtime, so a
// browser tab that loads this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { effectDoc } from './pool.ts'
import { provisionalDoc } from './provisional.ts'

export { effectDoc, provisionalDoc }

/** Every document this plugin declares — the pool's `effect` rows, which an
 * application loads when effects are to be written down and worked by any
 * process, the `lease` a duty is held under, and the `provisional` mark. A
 * vocabulary that wants only the mark loads `provisionalDoc` instead. */
export let docs: VocabDoc[] = [effectDoc]
