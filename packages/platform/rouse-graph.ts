// A sleeping wake armed by the write that makes its `while` hold
// (graph.ts `#rouse`).
import type { Plugin } from '@yaks/graph'
import type { Options } from './lent.ts'

export let plugins = (_host: unknown, { store }: Options): Plugin[] => [
  { name: 'yak/rouse', hooks: { effect: store.rouse } },
]
