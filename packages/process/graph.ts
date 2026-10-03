// This package as a graph plugin, exported as `@yaks/process/graph` for a
// caller assembling a graph's plugin list.

import type { Plugin } from '@yaks/graph'
import { processes } from './plugin.ts'

/** `process`, `service` and `exit`, as a graph plugin. */
export let plugins = (): Plugin[] => [processes()]
