import type { Plugin } from '@yaks/graph'
import { lenses } from './plugin.ts'
/** The rename vocabulary and translation hooks. */
export let rules = (): Plugin[] => [lenses()]
