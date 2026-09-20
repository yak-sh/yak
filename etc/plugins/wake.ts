// A reminder and its firing.
import type { Plugin } from '@yaks/graph'
import { wakeDoc, wakes } from '@yaks/wake'
export let vocab = wakeDoc
export let rules = (): Plugin[] => [wakes()]
