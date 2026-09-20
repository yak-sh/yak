// The program a session runs, and how it ended.
import type { Plugin } from '@yaks/graph'
import { processDoc, processes } from '@yaks/process'
export let vocab = processDoc
export let rules = (): Plugin[] => [processes()]
