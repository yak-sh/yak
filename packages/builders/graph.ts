// Every host importing builders installs the same transaction invariants. An
// input write reconciles immediate builders in its own transaction, answering
// in place the code tools the options hold (./code.ts). A host calls it as
// every graph facet, `plugins(host, options)`; builders reads nothing from the
// host.
import { choices } from './choice.ts'
import type { Here } from './change.ts'
import type { Plugin } from '@yaks/graph'
export let plugins = (_host?: unknown, here: Here = {}): Plugin[] => [
  choices(here),
]
