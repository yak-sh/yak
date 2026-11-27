// The effects this package contributes: the module a process working the
// effect pool imports at `@yaks/workflow/effects`. `step_run` runs an
// after-commit step a write owed; `step_fire` runs a step whose wake or watch
// fired.

import type { Access } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import { handlers } from './run.ts'

/** `step_run` and `step_fire`, writing through the host's graph. */
export let effects = (host: { graph: Access }): Handlers => handlers(host.graph)
