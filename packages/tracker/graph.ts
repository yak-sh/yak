// What the graph does with a write about a bug: the module a host imports as
// `@yaks/tracker/graph`. A bug's resolution carries its explanation.

import type { Plugin } from '@yaks/graph'
import { resolutions } from './resolution.ts'

/** The precondition that refuses a bug resolved without its explanation. */
export let plugins = (): Plugin[] => [resolutions()]
