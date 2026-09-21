// The component declarations, and only those: the module exported as
// `@yaks/effects/vocab`. It imports no storage, no SQL and no runtime, so a
// browser tab that loads this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { effectDoc } from './durable.ts'

export { effectDoc }

/** Every document this plugin declares — the durable tier's ledger, which an
 * application loads only when it wants effects that survive a crash. */
export let docs: VocabDoc[] = [effectDoc]
