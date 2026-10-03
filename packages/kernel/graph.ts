// What the graph does with a write about the kernel's marks: the module a
// server imports as `@yaks/kernel/graph`.

import type { Plugin } from '@yaks/graph'
import { kernel } from './plugin.ts'

/** The kernel components, and the hook that records who completed something. */
export let plugins = (): Plugin[] => [kernel()]
