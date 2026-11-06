// The executor's composition: the provider plugins whose models a frozen call
// may name (worker.ts `Plugin`). Nothing else in the executor names one; a
// call's own options (FrozenRequest `provider.with`) come from the kernel.
import * as openai from '@yaks/openai/provider'
import * as openrouter from '@yaks/openrouter/provider'
import type { Plugin } from './worker.ts'

export let plugins: Plugin[] = [{ facet: openai }, { facet: openrouter }]
