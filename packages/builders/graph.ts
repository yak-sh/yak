// Every host importing builders installs the same transaction invariants.
import { choices } from './choice.ts'
import type { Plugin } from '@yaks/graph'
export let plugins = (): Plugin[] => [choices()]
