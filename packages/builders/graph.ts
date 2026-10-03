// Every host importing builders installs the same output-choice invariant.
import { choices } from './choice.ts'
import type { Plugin } from '@yaks/graph'
export let plugins = (): Plugin[] => [choices()]
