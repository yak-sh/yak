// The component declarations, and only those: the module exported as
// `@yaks/effects/vocab`. It imports no storage, no SQL and no runtime, so a
// browser tab that loads this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { effectDoc } from './durable.ts'
import { provisionalDoc } from './provisional.ts'

export { effectDoc, provisionalDoc }

/** Every document this plugin declares — the durable tier's ledger, which an
 * application loads only when it wants effects that survive a crash, and the
 * `provisional` mark beside it. A vocabulary that wants only the mark loads
 * `provisionalDoc` instead. */
export let docs: VocabDoc[] = [effectDoc]
