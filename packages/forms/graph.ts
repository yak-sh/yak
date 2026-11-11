// The graph plugins this package contributes: the module a server imports at
// `@yaks/forms/graph`, so a registration is accepted only while its form is
// open and answered.

import type { Plugin } from '@yaks/graph'
import type { Options } from './options.ts'
import { formRules } from './rules.ts'

export type { Options } from './options.ts'
export { formRules } from './rules.ts'

/** The registration rules, on the host's clock. */
export let plugins = (_host: unknown, options: Options = {}): Plugin[] => [
  formRules(options.now ?? Date.now),
]
