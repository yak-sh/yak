// The graph plugins this package contributes: the module a server imports at
// `@yaks/doc/rules`. There are no write-time rules here, only the component
// itself.

import type { Plugin } from '@yaks/graph'
import { docs as plugin } from './plugin.ts'

/** `doc{title, body}`, as a graph plugin. */
export let rules = (): Plugin[] => [plugin()]
