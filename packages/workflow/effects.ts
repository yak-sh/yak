// The effects this package contributes: the module a process working the
// effect pool imports at `@yaks/workflow/effects`. `step_run` runs an
// after-commit step a write owed; `step_fire` runs a step whose wake or watch
// fired. Each writes through the door its effect is handed.

import type { Vocab } from '@yaks/vocab'
import type { Handlers } from '@yaks/effects'
import { handlers } from './run.ts'

/** `step_run` and `step_fire`, asking matches in the host's vocabulary. */
export let effects = (host: { vocab: Vocab }): Handlers => handlers(host.vocab)
