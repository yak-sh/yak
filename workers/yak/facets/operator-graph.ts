// The rule that keeps each entity's `owner{person}` in the commit that makes
// or changes what it is read from (operator-owner.ts).
import type { Plugin } from '@yaks/graph'
import { owning } from '../operator-owner.ts'
export let plugins = (): Plugin[] => [owning()]
